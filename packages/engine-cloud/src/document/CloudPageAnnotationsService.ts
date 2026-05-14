import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  encodeStableIdKey,
  type AnnotationDraft,
  type AnnotationListPageSnapshot,
  type AnnotationPatch,
  type AnnotationRef,
  type AnnotationCreateResult,
  type AnnotationDeleteResult,
  type AnnotationMoveResult,
  type AnnotationUpdateResult,
  type PageAnnotationsService,
  type PageObjectNumber,
} from '@embedpdf/engine-core/runtime';
import {
  AnnotationCreateResultSchema,
  AnnotationDeleteResultSchema,
  AnnotationListPageSnapshotSchema,
  AnnotationMoveResultSchema,
  AnnotationUpdateResultSchema,
  wirePaths,
} from '@embedpdf/engine-core/wire';
import type { HttpClient } from '../transport/HttpClient';

/**
 * Cloud-side page annotation service. Mirrors the local wiring: each
 * call produces an `AbortablePromise` that propagates `signal.abort()`
 * down to `fetch` and validates the JSON response with the wire-stable
 * Zod schema.
 *
 * Phase 4 note on URL versions: the server now publishes the
 * versioned annotation read at `/pages/:pon/v:A/annotations` (see
 * `wirePaths.docPageAnnotations`), and it is fully exercised by the
 * server's `doc-versioned-reads.test.ts`. The cloud SDK still uses
 * the un-versioned legacy path here because the mutation conformance
 * harness (`runAnnotationMutationConformance`) opens with `kind:
 * 'bytes'`, which seeds docs into the legacy `InMemoryDocumentStore`
 * — that store is invisible to `DocumentService.getManifest`. Phase 5
 * removes the legacy bytes-open + InMemoryDocumentStore in the same
 * patch that makes this service swap to `docPageAnnotations` with
 * the same `getJsonWithRefresh` pattern used by `CloudPageTextService`.
 *
 * The PATCH/DELETE/POST mutation routes already stay un-versioned —
 * HTTP semantics exempt them from cache, so versioning would be
 * ceremony with no payoff.
 */
export class CloudPageAnnotationsService implements PageAnnotationsService {
  constructor(
    private readonly http: HttpClient,
    private readonly docId: string,
    private readonly pageObjectNumber: PageObjectNumber,
    private readonly isClosed: () => boolean,
  ) {}

  list(): AbortablePromise<AnnotationListPageSnapshot> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<AnnotationListPageSnapshot>(async (signal) =>
      this.http.getJson(
        wirePaths.annotationsFullPage(this.docId, this.pageObjectNumber),
        (raw) => AnnotationListPageSnapshotSchema.parse(raw),
        signal,
      ),
    );
  }

  create(draft: AnnotationDraft): AbortablePromise<AnnotationCreateResult> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<AnnotationCreateResult>(async (signal) =>
      this.http.postJson(
        wirePaths.pageAnnotationsCreate(this.docId, this.pageObjectNumber),
        draft,
        (raw) => AnnotationCreateResultSchema.parse(raw),
        signal,
      ),
    );
  }

  update(ref: AnnotationRef, patch: AnnotationPatch): AbortablePromise<AnnotationUpdateResult> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    if (ref.pageObjectNumber !== this.pageObjectNumber) {
      return AbortablePromise.rejectReason(
        new EngineError(
          EngineErrorCode.InvalidArg,
          `ref.pageObjectNumber ${ref.pageObjectNumber} != page ${this.pageObjectNumber}`,
        ),
      );
    }
    if (ref.kind === 'index') {
      // Index refs cannot be addressed by stable id. Send the full ref
      // in the body so the server can validate the revision and resolve
      // it the same way the local mutator does.
      const path = wirePaths.annotationByKey(this.docId, ref.pageObjectNumber, 'index');
      return AbortablePromise.run<AnnotationUpdateResult>(async (signal) =>
        this.http.patchJson(
          path,
          { ref, patch },
          (raw) => AnnotationUpdateResultSchema.parse(raw),
          signal,
        ),
      );
    }
    const stableKey = encodeStableIdKey(refToStableId(ref));
    const path = wirePaths.annotationByKey(this.docId, ref.pageObjectNumber, stableKey);
    return AbortablePromise.run<AnnotationUpdateResult>(async (signal) =>
      this.http.patchJson(
        path,
        { patch },
        (raw) => AnnotationUpdateResultSchema.parse(raw),
        signal,
      ),
    );
  }

  delete(ref: AnnotationRef): AbortablePromise<AnnotationDeleteResult> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    if (ref.pageObjectNumber !== this.pageObjectNumber) {
      return AbortablePromise.rejectReason(
        new EngineError(
          EngineErrorCode.InvalidArg,
          `ref.pageObjectNumber ${ref.pageObjectNumber} != page ${this.pageObjectNumber}`,
        ),
      );
    }
    if (ref.kind === 'index') {
      // DELETE has no body in plain HTTP, so we PATCH the same
      // 'index' key with `{ ref, op: 'delete' }`. This keeps the
      // semantics atomic on the server (single round-trip).
      const path = wirePaths.annotationByKey(this.docId, ref.pageObjectNumber, 'index');
      return AbortablePromise.run<AnnotationDeleteResult>(async (signal) =>
        this.http.patchJson(
          path,
          { ref, op: 'delete' },
          (raw) => AnnotationDeleteResultSchema.parse(raw),
          signal,
        ),
      );
    }
    const stableKey = encodeStableIdKey(refToStableId(ref));
    const path = wirePaths.annotationByKey(this.docId, ref.pageObjectNumber, stableKey);
    return AbortablePromise.run<AnnotationDeleteResult>(async (signal) =>
      this.http.deleteJson(path, (raw) => AnnotationDeleteResultSchema.parse(raw), signal),
    );
  }

  move(refs: AnnotationRef[], toIndex: number): AbortablePromise<AnnotationMoveResult> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    // The page is part of the URL; the worker validates per-ref consistency
    // again, but rejecting up front gives a cleaner error from the client side.
    for (const r of refs) {
      if (r.pageObjectNumber !== this.pageObjectNumber) {
        return AbortablePromise.rejectReason(
          new EngineError(
            EngineErrorCode.InvalidArg,
            `move ref points at page ${r.pageObjectNumber}; service is bound to page ${this.pageObjectNumber}`,
          ),
        );
      }
    }
    const path = wirePaths.pageAnnotationsMove(this.docId, this.pageObjectNumber);
    return AbortablePromise.run<AnnotationMoveResult>(async (signal) =>
      this.http.postJson(
        path,
        { refs, toIndex },
        (raw) => AnnotationMoveResultSchema.parse(raw),
        signal,
      ),
    );
  }
}

/**
 * Local helper: project a non-index `AnnotationRef` into the matching
 * `AnnotationStableId` shape so we can route by stable key. The compiler
 * narrows on `ref.kind` here so we can't accidentally pass an index ref.
 */
function refToStableId(
  ref: Extract<AnnotationRef, { kind: 'objectNumber' | 'nm' }>,
): { kind: 'objectNumber'; value: number } | { kind: 'nm'; value: string } {
  if (ref.kind === 'objectNumber') {
    return { kind: 'objectNumber', value: ref.annotObjectNumber };
  }
  return { kind: 'nm', value: ref.nm };
}
