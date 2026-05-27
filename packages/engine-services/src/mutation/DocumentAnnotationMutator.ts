import type { PdfRuntimeModule, Ptr } from '@embedpdf/pdf-runtime';
import {
  EngineError,
  EngineErrorCode,
  PDF_SUBTYPE_TO_CODE,
  type AnnotationActor,
  type AnnotationCreateResult,
  type AnnotationDeleteResult,
  type AnnotationDTO,
  type AnnotationDraft,
  type AnnotationListMutationMeta,
  type AnnotationMoveResult,
  type AnnotationPatch,
  type AnnotationRef,
  type AnnotationStableId,
  type AnnotationUpdateResult,
  type PageObjectNumber,
} from '@embedpdf/engine-core/runtime';
import { throwIfAborted } from '../abort';
import { readAnnotString } from '../readers/annotations/util';
import { readAnnotationFromPtr } from '../readers/annotations/read-one';
import { writeAnnotationModified, writeAnnotationNm } from '../writers/annotations/base';
import {
  applyEmbedMetadataOnCreate,
  applyEmbedMetadataOnUpdate,
} from '../writers/annotations/embed-metadata';
import { applyDraft, applyPatch } from '../writers/annotations/registry';
import { generateUuid } from '../util/uuid';
import type { DocumentSession } from '../session/DocumentSession';
import { ImpactComputer } from './ImpactComputer';

/**
 * Synchronous orchestrator for `create` / `update` / `delete` annotation
 * mutations. Owns the dance between PDFium calls, identity bookkeeping,
 * revision bumping (only for structural ops), and the
 * `AnnotationListMutationMeta` envelope every result type carries.
 *
 * Lives in `engine-services` (not the worker hosts) so the local Web
 * Worker, the Node `worker_thread` server, and any future direct-thread
 * embedding share the exact same code path. The only difference between
 * them is the underlying `PdfRuntimeModule` (WASM vs native).
 *
 * Identity rules enforced here, locked with the user:
 *   - `create` always uses `EPDFPage_CreateAnnot` (the fork helper that
 *     creates an INDIRECT object) so new annotations are born durable.
 *     If the fork helper ever returns a direct object, we throw — never
 *     silently produce a weak annotation.
 *   - `update` is non-structural. /NM is monotonic per annotation:
 *       * already durable (objectNumber > 0 OR /NM present) -> NEVER touched.
 *       * weak (no objectNumber, no /NM) -> stamp engine-generated UUID v4.
 *     The patch type has no `nm` field, so the writer surface enforces
 *     "callers cannot rename a stable id" at the type level. Updates do
 *     not bump the revision.
 *   - `delete` is subtype-agnostic. Three native fork helpers handle the
 *     three ref kinds without round-tripping through index. For weak
 *     deletes (`AnnotationStableId | null`-shaped result), we set
 *     `deleted: null` so callers can detect that no durable id was
 *     reportable.
 */
export class DocumentAnnotationMutator {
  constructor(
    private readonly runtime: PdfRuntimeModule,
    private readonly session: DocumentSession,
  ) {}

  create(
    pageObjectNumber: PageObjectNumber,
    draft: AnnotationDraft,
    signal: AbortSignal,
    actor?: AnnotationActor,
  ): AnnotationCreateResult {
    throwIfAborted(signal);
    const { fn, mem } = this.runtime;
    const subtypeCode = PDF_SUBTYPE_TO_CODE[draft.subtype];

    const pool = this.session.pagePool();
    const pagePtr = pool.acquire(pageObjectNumber);
    try {
      this.ensureKnownWeakStateFromPage(pageObjectNumber, pagePtr);
      // `create` is append-only: PDFium drops the new annotation at
      // `index = previousCount`, so no existing index ever shifts. Per
      // the locked rule in `ImpactComputer`, that means create is
      // non-invalidating — no per-page revision bump, no weak-ref
      // staleness signal. The DTO is read against the page's current
      // revision (which both pre-existing and freshly-created
      // annotations share, since nothing bumped it).
      const pageStateBefore = this.session.pageState(pageObjectNumber);
      throwIfAborted(signal);

      const annotPtr = fn.EPDFPage_CreateAnnot(pagePtr, subtypeCode);
      if (!annotPtr) {
        throw new EngineError(
          EngineErrorCode.Unknown,
          `EPDFPage_CreateAnnot returned NULL for subtype '${draft.subtype}'`,
        );
      }

      let dto;
      let newObjNum: number;
      let newIndex: number;
      try {
        applyDraft(fn, mem, annotPtr, draft);
        // Stamp standard ISO 32000 /M (modified date) — always, regardless
        // of whether an actor is supplied. Then stamp the EmbedPDF-namespaced
        // /EMBD_Metadata if the actor carries identity. Both happen after
        // the per-subtype writer so a buggy subtype writer can't clobber them.
        writeAnnotationModified(fn, mem, annotPtr);
        applyEmbedMetadataOnCreate(fn, mem, annotPtr, actor);
        throwIfAborted(signal);

        newObjNum = fn.EPDFAnnot_GetObjectNumber(annotPtr);
        if (newObjNum <= 0) {
          // Defensive: the fork helper guarantees an indirect object.
          throw new EngineError(
            EngineErrorCode.Unknown,
            `EPDFPage_CreateAnnot produced a direct object (no objectNumber); fork helper invariant broken`,
          );
        }
        newIndex = fn.FPDFPage_GetAnnotIndex(pagePtr, annotPtr);
        if (newIndex < 0) {
          throw new EngineError(
            EngineErrorCode.Unknown,
            `FPDFPage_GetAnnotIndex returned ${newIndex} for freshly created annotation`,
          );
        }

        dto = readAnnotationFromPtr(
          fn,
          mem,
          annotPtr,
          pageObjectNumber,
          newIndex,
          pageStateBefore.revision,
        );
      } finally {
        fn.FPDFPage_CloseAnnot(annotPtr);
      }

      const pageStateAfter = this.session.pageState(pageObjectNumber);
      const meta: AnnotationListMutationMeta = ImpactComputer.compute({
        mutation: 'create',
        pageStateBefore,
        pageStateAfter,
        changed: [{ kind: 'objectNumber', value: newObjNum }],
      });

      return { created: dto, meta };
    } finally {
      pool.release(pageObjectNumber);
    }
  }

  update(
    ref: AnnotationRef,
    patch: AnnotationPatch,
    signal: AbortSignal,
    actor?: AnnotationActor,
  ): AnnotationUpdateResult {
    throwIfAborted(signal);
    const { fn, mem } = this.runtime;
    const pool = this.session.pagePool();
    const pagePtr = pool.acquire(ref.pageObjectNumber);
    let annotPtr: Ptr | null = null;
    try {
      annotPtr = this.resolveAnnotPtr(pagePtr, ref);
      throwIfAborted(signal);

      this.ensureKnownWeakStateFromPage(ref.pageObjectNumber, pagePtr);
      const pageStateBefore = this.session.pageState(ref.pageObjectNumber);

      // Opportunistic /NM stamp for weak annotations + capture the
      // resulting stable id for `meta.changed`. Same monotonic /NM
      // rule that `move()` uses; sharing the helper guarantees the
      // two paths cannot drift in their identity bookkeeping.
      const stableId = this.captureOrStampStableId(annotPtr);

      // Apply caller-supplied subtype-specific writes.
      applyPatch(fn, mem, annotPtr, patch);
      // Refresh standard /M (modified date) on every update — independent
      // of whether the patch touched any subtype-specific field. Then
      // refresh /EMBD_Metadata/UpdatedBy if an actor was supplied;
      // UserID/GroupID/CreatedBy are preserved across updates.
      writeAnnotationModified(fn, mem, annotPtr);
      applyEmbedMetadataOnUpdate(fn, mem, annotPtr, actor);
      throwIfAborted(signal);

      // Read back. Update is non-structural, so the index does NOT move
      // and the revision does NOT bump.
      const newIndex = fn.FPDFPage_GetAnnotIndex(pagePtr, annotPtr);
      if (newIndex < 0) {
        throw new EngineError(
          EngineErrorCode.Unknown,
          `FPDFPage_GetAnnotIndex returned ${newIndex} after update`,
        );
      }
      const dto = readAnnotationFromPtr(
        fn,
        mem,
        annotPtr,
        ref.pageObjectNumber,
        newIndex,
        pageStateBefore.revision,
      );

      this.recordWeakStateFromPage(ref.pageObjectNumber, pagePtr);
      const pageStateAfter = this.session.pageState(ref.pageObjectNumber);
      const meta = ImpactComputer.compute({
        mutation: 'update',
        pageStateBefore,
        pageStateAfter,
        changed: [stableId],
      });
      return { updated: dto, meta };
    } finally {
      if (annotPtr !== null) fn.FPDFPage_CloseAnnot(annotPtr);
      pool.release(ref.pageObjectNumber);
    }
  }

  delete(ref: AnnotationRef, signal: AbortSignal): AnnotationDeleteResult {
    throwIfAborted(signal);
    const { fn, mem } = this.runtime;
    const pool = this.session.pagePool();
    const pagePtr = pool.acquire(ref.pageObjectNumber);
    let bumpRequested = false;
    try {
      this.ensureKnownWeakStateFromPage(ref.pageObjectNumber, pagePtr);
      const pageStateBefore = this.session.pageState(ref.pageObjectNumber);
      throwIfAborted(signal);

      let deleted: AnnotationStableId | null;
      let ok = false;
      switch (ref.kind) {
        case 'objectNumber': {
          // Probe so we 404 honestly before mutating. The fork helper
          // does its own existence check too, but we want a clean
          // InvalidReference up front rather than a "false" return code
          // we'd have to translate.
          const probe = fn.EPDFPage_GetAnnotByObjectNumber(pagePtr, ref.annotObjectNumber);
          if (!probe) {
            throw new EngineError(
              EngineErrorCode.InvalidReference,
              `no annotation with object number ${ref.annotObjectNumber} on page ${ref.pageObjectNumber}`,
            );
          }
          fn.FPDFPage_CloseAnnot(probe);
          bumpRequested = true;
          ok = fn.EPDFPage_RemoveAnnotByObjectNumber(pagePtr, ref.annotObjectNumber);
          deleted = { kind: 'objectNumber', value: ref.annotObjectNumber };
          break;
        }
        case 'nm': {
          const namePtr = mem.writeU16String(ref.nm);
          try {
            const probe = fn.EPDFPage_GetAnnotByName(pagePtr, namePtr);
            if (!probe) {
              throw new EngineError(
                EngineErrorCode.InvalidReference,
                `no annotation with /NM '${ref.nm}' on page ${ref.pageObjectNumber}`,
              );
            }
            fn.FPDFPage_CloseAnnot(probe);
            bumpRequested = true;
            ok = fn.EPDFPage_RemoveAnnotByName(pagePtr, namePtr);
          } finally {
            mem.free(namePtr);
          }
          deleted = { kind: 'nm', value: ref.nm };
          break;
        }
        case 'index': {
          this.session.validateRevision(ref.revision);
          const annotPtr = fn.FPDFPage_GetAnnot(pagePtr, ref.index);
          if (!annotPtr) {
            throw new EngineError(
              EngineErrorCode.InvalidReference,
              `index ${ref.index} out of range on page ${ref.pageObjectNumber}`,
            );
          }
          let probedObjNum: number;
          let probedNm: string | null;
          try {
            probedObjNum = fn.EPDFAnnot_GetObjectNumber(annotPtr);
            probedNm = readAnnotString(fn, mem, annotPtr, 'NM');
          } finally {
            fn.FPDFPage_CloseAnnot(annotPtr);
          }
          deleted =
            probedObjNum > 0
              ? { kind: 'objectNumber', value: probedObjNum }
              : probedNm !== null && probedNm.length > 0
                ? { kind: 'nm', value: probedNm }
                : null;
          bumpRequested = true;
          // EPDFPage_RemoveAnnot is the fork helper that ALSO cleans up
          // the indirect object if the annotation has one. The vanilla
          // FPDFPage_RemoveAnnot would leak the indirect object.
          ok = fn.EPDFPage_RemoveAnnot(pagePtr, ref.index);
          break;
        }
      }
      if (!ok) {
        throw new EngineError(EngineErrorCode.Unknown, `failed to remove annotation: ${ref.kind}`);
      }

      // Structural change; bump the local index-space epoch now and stop
      // the finally-bump. Do not gate this on the page's current weak state:
      // old snapshots can still hold index refs from before annotations were
      // strengthened, and delete/move can make those refs point elsewhere.
      this.session.bumpRevision(ref.pageObjectNumber);
      bumpRequested = false;
      this.recordWeakStateFromPage(ref.pageObjectNumber, pagePtr);
      const pageStateAfter = this.session.pageState(ref.pageObjectNumber);

      const meta = ImpactComputer.compute({
        mutation: 'delete',
        pageStateBefore,
        pageStateAfter,
        changed: deleted ? [deleted] : [],
      });
      return { deleted, meta };
    } finally {
      if (bumpRequested) this.session.bumpRevision(ref.pageObjectNumber);
      pool.release(ref.pageObjectNumber);
    }
  }

  /**
   * Batch reorder of a contiguous block of annotations within a single
   * page's /Annots array. Symmetric with `pages.move()` for pages.
   *
   * Semantics (locked with the user, mirrors `EPDFPage_MoveAnnots`):
   *   - Each ref in `refs` is resolved to its current /Annots index.
   *     The block is detached, then re-inserted at `toIndex` in the
   *     post-removal index space, preserving caller-supplied order.
   *   - Single-annotation case is `move([ref], toIndex)`. There is no
   *     separate single-move path; one batch primitive serves both.
   *   - Atomic from the caller's perspective:
   *       * one revision bump per batch, regardless of `refs.length`.
   *       * one `AnnotationListMutationMeta` envelope.
   *       * if `EPDFPage_MoveAnnots` rejects (returns false) the page is
   *         untouched and we throw `InvalidArg` without bumping.
   *   - Identity strengthening: each weak ref in the batch (no
   *     `objectNumber`, no `/NM`) is opportunistically stamped with a
   *     fresh engine-generated UUID v4 BEFORE the move. So
   *     `meta.changed` always lists durable stable ids, and the moved
   *     DTOs come out durable. Same monotonic `/NM` rule as `update()`.
   *
   * Validation rules applied here BEFORE calling the helper, so callers
   * get clean errors instead of an opaque `false` return code:
   *   - `refs.length >= 1`.
   *   - All refs target the page identified by `pageObjectNumber`.
   *   - `toIndex >= 0` and `toIndex <= count - refs.length` (count is
   *     captured AFTER ref resolution, so the helper sees the same view).
   *   - Resolved indices have no duplicates.
   *
   * The `EPDFPage_MoveAnnots` helper itself enforces the same rules; the
   * up-front validation is purely for a usable error surface.
   */
  move(
    pageObjectNumber: PageObjectNumber,
    refs: AnnotationRef[],
    toIndex: number,
    signal: AbortSignal,
  ): AnnotationMoveResult {
    throwIfAborted(signal);
    if (refs.length === 0) {
      throw new EngineError(EngineErrorCode.InvalidArg, 'move requires at least one ref');
    }
    if (toIndex < 0 || !Number.isInteger(toIndex)) {
      throw new EngineError(
        EngineErrorCode.InvalidArg,
        `move toIndex must be a non-negative integer (got ${toIndex})`,
      );
    }
    for (const r of refs) {
      if (r.pageObjectNumber !== pageObjectNumber) {
        throw new EngineError(
          EngineErrorCode.InvalidArg,
          `move refs must all target page ${pageObjectNumber}; got ref on page ${r.pageObjectNumber}`,
        );
      }
    }

    const { fn, mem } = this.runtime;
    const pool = this.session.pagePool();
    const pagePtr = pool.acquire(pageObjectNumber);
    let bumpRequested = false;

    try {
      this.ensureKnownWeakStateFromPage(pageObjectNumber, pagePtr);
      const pageStateBefore = this.session.pageState(pageObjectNumber);
      throwIfAborted(signal);

      // 1. Resolve every ref in caller order. For each: capture its
      //    current /Annots index and its (possibly newly-stamped)
      //    stable id. We close each annotPtr right after probing — the
      //    move helper takes the page-level pointer, and we'll re-open
      //    annotPtrs later by *new* index for the readback.
      const fromIndices: number[] = new Array(refs.length);
      const stableIds: AnnotationStableId[] = new Array(refs.length);
      for (let i = 0; i < refs.length; i++) {
        throwIfAborted(signal);
        const annotPtr = this.resolveAnnotPtr(pagePtr, refs[i]);
        try {
          const idx = fn.FPDFPage_GetAnnotIndex(pagePtr, annotPtr);
          if (idx < 0) {
            throw new EngineError(
              EngineErrorCode.Unknown,
              `FPDFPage_GetAnnotIndex returned ${idx} during move resolution`,
            );
          }
          fromIndices[i] = idx;
          stableIds[i] = this.captureOrStampStableId(annotPtr);
        } finally {
          fn.FPDFPage_CloseAnnot(annotPtr);
        }
      }

      // 2. Reject duplicate source indices up front. Two refs that
      //    resolve to the same index would violate the helper's
      //    invariant (and would also be a confused caller).
      const seen = new Set<number>();
      for (const idx of fromIndices) {
        if (seen.has(idx)) {
          throw new EngineError(
            EngineErrorCode.InvalidArg,
            `move refs resolve to duplicate /Annots index ${idx}`,
          );
        }
        seen.add(idx);
      }

      // 3. Range-check toIndex against the post-removal count, matching
      //    the helper's contract.
      const count = fn.FPDFPage_GetAnnotCount(pagePtr);
      const postRemovalCount = count - fromIndices.length;
      if (toIndex > postRemovalCount) {
        throw new EngineError(
          EngineErrorCode.InvalidArg,
          `move toIndex ${toIndex} out of range; post-removal count is ${postRemovalCount}`,
        );
      }

      // 4. Marshal fromIndices into an i32 array in runtime memory and
      //    invoke the helper. From this call onward a structural change
      //    may have happened; finally-bump on any failure.
      const arrBytes = 4 * fromIndices.length;
      const arrPtr = mem.alloc(arrBytes);
      let ok: boolean;
      try {
        for (let i = 0; i < fromIndices.length; i++) {
          mem.poke(arrPtr, 'i32', fromIndices[i], 4 * i);
        }
        bumpRequested = true;
        ok = fn.EPDFPage_MoveAnnots(pagePtr, arrPtr, fromIndices.length, toIndex);
      } finally {
        mem.free(arrPtr);
      }

      if (!ok) {
        // The helper validates atomically: a `false` return means it
        // rejected the request and made no changes. Cancel the pending
        // bump and surface a clean error.
        bumpRequested = false;
        throw new EngineError(
          EngineErrorCode.InvalidArg,
          `EPDFPage_MoveAnnots rejected the request (toIndex=${toIndex}, fromIndices=[${fromIndices.join(
            ',',
          )}])`,
        );
      }

      // 5. Single revision bump for the whole batch. This is the local
      //    index-space epoch, so it advances for every successful move even
      //    if the page is currently strong. Read back DTOs against the
      //    bumped revision so they are internally consistent.
      const bumpedRev = this.session.bumpRevision(pageObjectNumber);
      bumpRequested = false;

      const moved: AnnotationDTO[] = new Array(fromIndices.length);
      for (let i = 0; i < fromIndices.length; i++) {
        throwIfAborted(signal);
        const newIdx = toIndex + i;
        const annotPtr = fn.FPDFPage_GetAnnot(pagePtr, newIdx);
        if (!annotPtr) {
          throw new EngineError(
            EngineErrorCode.Unknown,
            `failed to re-read moved annotation at index ${newIdx}`,
          );
        }
        try {
          moved[i] = readAnnotationFromPtr(fn, mem, annotPtr, pageObjectNumber, newIdx, bumpedRev);
        } finally {
          fn.FPDFPage_CloseAnnot(annotPtr);
        }
      }

      this.recordWeakStateFromPage(pageObjectNumber, pagePtr);
      const pageStateAfter = this.session.pageState(pageObjectNumber);
      const meta: AnnotationListMutationMeta = ImpactComputer.compute({
        mutation: 'move',
        pageStateBefore,
        pageStateAfter,
        changed: stableIds,
      });
      return { moved, meta };
    } finally {
      if (bumpRequested) this.session.bumpRevision(pageObjectNumber);
      pool.release(pageObjectNumber);
    }
  }

  /**
   * Read an annotation's stable id, opportunistically stamping a fresh
   * engine-generated UUID v4 as `/NM` if it is currently weak (no
   * objectNumber, no /NM). Same monotonic `/NM` rule as `update()`:
   * already-durable annotations are NEVER touched. Caller owns the
   * lifecycle of `annotPtr`.
   */
  private captureOrStampStableId(annotPtr: Ptr): AnnotationStableId {
    const { fn, mem } = this.runtime;
    const objNum = fn.EPDFAnnot_GetObjectNumber(annotPtr);
    if (objNum > 0) return { kind: 'objectNumber', value: objNum };
    const nm = readAnnotString(fn, mem, annotPtr, 'NM');
    if (nm !== null && nm.length > 0) return { kind: 'nm', value: nm };
    const minted = generateUuid();
    writeAnnotationNm(fn, mem, annotPtr, minted);
    return { kind: 'nm', value: minted };
  }

  private ensureKnownWeakStateFromPage(pageObjectNumber: PageObjectNumber, pagePtr: Ptr): void {
    if (this.session.weakAnnotationState(pageObjectNumber).kind === 'known') {
      return;
    }
    this.recordWeakStateFromPage(pageObjectNumber, pagePtr);
  }

  private recordWeakStateFromPage(pageObjectNumber: PageObjectNumber, pagePtr: Ptr): void {
    this.session.recordWeakFlag(pageObjectNumber, this.computeHasWeakAnnotations(pagePtr));
  }

  private computeHasWeakAnnotations(pagePtr: Ptr): boolean {
    const { fn, mem } = this.runtime;
    const count = fn.FPDFPage_GetAnnotCount(pagePtr);
    if (count < 0) {
      throw new EngineError(
        EngineErrorCode.Unknown,
        `FPDFPage_GetAnnotCount returned ${count} while computing weak annotations`,
      );
    }
    for (let i = 0; i < count; i++) {
      const annotPtr = fn.FPDFPage_GetAnnot(pagePtr, i);
      if (!annotPtr) {
        continue;
      }
      try {
        const objNum = fn.EPDFAnnot_GetObjectNumber(annotPtr);
        if (objNum > 0) {
          continue;
        }
        const nm = readAnnotString(fn, mem, annotPtr, 'NM');
        if (nm === null || nm.length === 0) {
          return true;
        }
      } finally {
        fn.FPDFPage_CloseAnnot(annotPtr);
      }
    }
    return false;
  }

  /**
   * Inline counterpart to `AnnotationIdentityResolver.resolve` that does
   * NOT acquire its own pagePtr (we already hold one) and does NOT close
   * the annotPtr (the caller owns the lifetime). Mirrors the resolution
   * order in the wire spec.
   */
  private resolveAnnotPtr(pagePtr: Ptr, ref: AnnotationRef): Ptr {
    const { fn, mem } = this.runtime;
    switch (ref.kind) {
      case 'objectNumber': {
        const annotPtr = fn.EPDFPage_GetAnnotByObjectNumber(pagePtr, ref.annotObjectNumber);
        if (!annotPtr) {
          throw new EngineError(
            EngineErrorCode.InvalidReference,
            `no annotation with object number ${ref.annotObjectNumber} on page ${ref.pageObjectNumber}`,
          );
        }
        return annotPtr;
      }
      case 'nm': {
        const namePtr = mem.writeU16String(ref.nm);
        try {
          const annotPtr = fn.EPDFPage_GetAnnotByName(pagePtr, namePtr);
          if (!annotPtr) {
            throw new EngineError(
              EngineErrorCode.InvalidReference,
              `no annotation with /NM '${ref.nm}' on page ${ref.pageObjectNumber}`,
            );
          }
          return annotPtr;
        } finally {
          mem.free(namePtr);
        }
      }
      case 'index': {
        this.session.validateRevision(ref.revision);
        const annotPtr = fn.FPDFPage_GetAnnot(pagePtr, ref.index);
        if (!annotPtr) {
          throw new EngineError(
            EngineErrorCode.InvalidReference,
            `index ${ref.index} out of range on page ${ref.pageObjectNumber}`,
          );
        }
        return annotPtr;
      }
    }
    throw new EngineError(EngineErrorCode.InvalidArg, `unsupported annotation ref kind`);
  }
}
