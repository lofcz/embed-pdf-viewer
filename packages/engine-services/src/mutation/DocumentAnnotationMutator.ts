import type { PdfRuntimeModule, Ptr } from '@embedpdf/pdf-runtime';
import {
  EngineError,
  EngineErrorCode,
  KIND_BY_SUBTYPE,
  type AnnotationCreateResult,
  type AnnotationDeleteResult,
  type AnnotationDraft,
  type AnnotationListMutationMeta,
  type AnnotationPatch,
  type AnnotationRef,
  type AnnotationStableId,
  type AnnotationUpdateResult,
  type PageObjectNumber,
} from '@embedpdf/engine-core';
import { throwIfAborted } from '../abort';
import { readAnnotString } from '../readers/annotations/util';
import { readAnnotationFromPtr } from '../readers/annotations/read-one';
import { writeAnnotationNm } from '../writers/annotations/base';
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
  ): AnnotationCreateResult {
    throwIfAborted(signal);
    const { fn, mem } = this.runtime;
    // KIND_BY_SUBTYPE is keyed by every AnnotationKind, but
    // AnnotationDraft is the closed union of *writable* subtypes
    // (text-markup today; `unsupported` has Draft = never), so the
    // lookup is always defined for a valid draft.
    const subtypeCode = KIND_BY_SUBTYPE[draft.subtype].pdfSubtypeCode;

    const pool = this.session.pagePool();
    const pagePtr = pool.acquire(pageObjectNumber);
    let bumpRequested = false;
    try {
      const pageStateBefore = this.session.pageState(pageObjectNumber);
      throwIfAborted(signal);

      const annotPtr = fn.EPDFPage_CreateAnnot(pagePtr, subtypeCode);
      if (!annotPtr) {
        throw new EngineError(
          EngineErrorCode.Unknown,
          `EPDFPage_CreateAnnot returned NULL for subtype '${draft.subtype}'`,
        );
      }
      // Past this point the page now contains a new annotation. Even if a
      // later step (write/readback) throws, the structural change has
      // happened — make sure the revision gets bumped in `finally`.
      bumpRequested = true;

      let dto;
      let newObjNum: number;
      let newIndex: number;
      try {
        applyDraft(fn, mem, annotPtr, draft);
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

        // Bump revision now (structural). Read the DTO with the bumped
        // revision so the result is internally consistent.
        const bumpedRev = this.session.bumpRevision(pageObjectNumber);
        bumpRequested = false; // consumed
        dto = readAnnotationFromPtr(fn, mem, annotPtr, pageObjectNumber, newIndex, bumpedRev);
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
      // Make sure a partial-success structural mutation still bumps the
      // revision so the next read sees a fresh generation.
      if (bumpRequested) this.session.bumpRevision(pageObjectNumber);
      pool.release(pageObjectNumber);
    }
  }

  update(ref: AnnotationRef, patch: AnnotationPatch, signal: AbortSignal): AnnotationUpdateResult {
    throwIfAborted(signal);
    const { fn, mem } = this.runtime;
    const pool = this.session.pagePool();
    const pagePtr = pool.acquire(ref.pageObjectNumber);
    let annotPtr: Ptr | null = null;
    try {
      annotPtr = this.resolveAnnotPtr(pagePtr, ref);
      throwIfAborted(signal);

      const pageStateBefore = this.session.pageState(ref.pageObjectNumber);

      // Opportunistic /NM stamp for weak annotations. /NM is monotonic per
      // annotation: already-durable annotations are never touched.
      const existingObjNum = fn.EPDFAnnot_GetObjectNumber(annotPtr);
      const existingNm = readAnnotString(fn, mem, annotPtr, 'NM');
      const isWeak = existingObjNum <= 0 && (existingNm === null || existingNm.length === 0);
      if (isWeak) {
        const minted = generateUuid();
        writeAnnotationNm(fn, mem, annotPtr, minted);
      }

      // Apply caller-supplied subtype-specific writes.
      applyPatch(fn, mem, annotPtr, patch);
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

      const pageStateAfter = this.session.pageState(ref.pageObjectNumber);
      const meta = ImpactComputer.compute({
        mutation: 'update',
        pageStateBefore,
        pageStateAfter,
        changed: [stableIdFromDTO(dto.ref, existingObjNum, dto.nm)],
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
      const pageStateBefore = this.session.pageState(ref.pageObjectNumber);
      throwIfAborted(signal);

      let deleted: AnnotationStableId | null;
      let ok: boolean;
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

      // Structural change; bump revision now and stop the finally-bump.
      this.session.bumpRevision(ref.pageObjectNumber);
      bumpRequested = false;
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
  }
}

/**
 * Pick the best stable id for the `meta.changed` entry of an updated
 * annotation. After the opportunistic stamp the DTO ref is already the
 * strongest available; we just translate it into the wire-stable
 * `AnnotationStableId` shape. The `existingObjNum` and `nm` arguments are
 * a defensive fallback for the (unreachable) case where the DTO ref is
 * `kind: 'index'` despite the annotation being durable.
 */
function stableIdFromDTO(
  ref:
    | { kind: 'objectNumber'; annotObjectNumber: number }
    | { kind: 'nm'; nm: string }
    | { kind: 'index' },
  existingObjNum: number,
  nm: string | null,
): AnnotationStableId {
  if (ref.kind === 'objectNumber') {
    return { kind: 'objectNumber', value: ref.annotObjectNumber };
  }
  if (ref.kind === 'nm') {
    return { kind: 'nm', value: ref.nm };
  }
  if (existingObjNum > 0) return { kind: 'objectNumber', value: existingObjNum };
  if (nm !== null && nm.length > 0) return { kind: 'nm', value: nm };
  // Genuinely unreachable: an updated annotation has at minimum its
  // engine-stamped /NM. We throw rather than return a sentinel so any
  // future regression is caught loudly in tests.
  throw new EngineError(
    EngineErrorCode.Unknown,
    'updated annotation has no durable identity after update',
  );
}
