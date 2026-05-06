import {
  AbortablePromise,
  AnnotationCreateResultSchema,
  AnnotationDeleteResultSchema,
  AnnotationListPageSnapshotSchema,
  AnnotationUpdateResultSchema,
  EngineError,
  EngineErrorCode,
  encodeStableIdKey,
  wirePaths,
  type AnnotationDraft,
  type AnnotationListPageSnapshot,
  type AnnotationPatch,
  type AnnotationRef,
  type AnnotationCreateResult,
  type AnnotationDeleteResult,
  type AnnotationUpdateResult,
  type PageAnnotationsService,
  type PageObjectNumber,
} from '@embedpdf/engine-core';
import type { HttpClient } from '../transport/HttpClient';

/**
 * Cloud-side page annotation service. Mirrors the local wiring: each
 * call produces an `AbortablePromise` that propagates `signal.abort()`
 * down to `fetch` and validates the JSON response with the wire-stable
 * Zod schema.
 *
 * The PATCH/DELETE routes address an annotation by stable id encoded
 * via `encodeStableIdKey`. Index refs cannot be encoded as a stable
 * id (no durable identity), so they travel as a JSON body on a PATCH
 * to a different sub-path. The server resolves the ref the same way
 * the local mutator does.
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
