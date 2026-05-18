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
  type MutationMeta,
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
import type { ManifestAccessor } from './CloudDocumentHandle';

/**
 * Cloud-side page annotation service. Mirrors the local wiring: each
 * call produces an `AbortablePromise` that propagates `signal.abort()`
 * down to `fetch` and validates the JSON response with the wire-stable
 * Zod schema.
 *
 * Reads use immutable versioned layer URLs discovered from the
 * manifest. Mutations use unversioned layer URLs and are never cached.
 */
export class CloudPageAnnotationsService implements PageAnnotationsService {
  constructor(
    private readonly http: HttpClient,
    private readonly docId: string,
    private readonly layerName: string,
    private readonly pageObjectNumber: PageObjectNumber,
    private readonly isClosed: () => boolean,
    private readonly manifest: ManifestAccessor,
  ) {}

  list(): AbortablePromise<AnnotationListPageSnapshot> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<AnnotationListPageSnapshot>(async (signal) => {
      const buildPath = async (s: AbortSignal): Promise<string> => {
        const manifest = await this.manifest.get(s);
        const page = manifest.pages.find((p) => p.state.pageObjectNumber === this.pageObjectNumber);
        if (!page) {
          throw new EngineError(
            EngineErrorCode.NotFound,
            `no page with object number ${this.pageObjectNumber} in document ${this.docId}`,
          );
        }
        return wirePaths.layerPageAnnotations(
          this.docId,
          this.layerName,
          this.pageObjectNumber,
          page.cache.annotationVersion,
        );
      };
      return this.http.getJsonWithRefresh(
        buildPath,
        (raw) => AnnotationListPageSnapshotSchema.parse(raw),
        async (s) => {
          await this.manifest.refresh(s);
        },
        signal,
      );
    });
  }

  create(draft: AnnotationDraft): AbortablePromise<AnnotationCreateResult> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<AnnotationCreateResult>(async (signal) => {
      const result = await this.http.postJson(
        wirePaths.layerPageAnnotationsCreate(this.docId, this.layerName, this.pageObjectNumber),
        draft,
        (raw) => AnnotationCreateResultSchema.parse(raw),
        signal,
      );
      return this.absorbMutation(result);
    });
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
      const path = wirePaths.layerAnnotationByKey(
        this.docId,
        this.layerName,
        ref.pageObjectNumber,
        'index',
      );
      return AbortablePromise.run<AnnotationUpdateResult>(async (signal) => {
        const result = await this.http.patchJson(
          path,
          { ref, patch },
          (raw) => AnnotationUpdateResultSchema.parse(raw),
          signal,
        );
        return this.absorbMutation(result);
      });
    }
    const stableKey = encodeStableIdKey(refToStableId(ref));
    const path = wirePaths.layerAnnotationByKey(
      this.docId,
      this.layerName,
      ref.pageObjectNumber,
      stableKey,
    );
    return AbortablePromise.run<AnnotationUpdateResult>(async (signal) => {
      const result = await this.http.patchJson(
        path,
        { patch },
        (raw) => AnnotationUpdateResultSchema.parse(raw),
        signal,
      );
      return this.absorbMutation(result);
    });
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
      const path = wirePaths.layerAnnotationByKey(
        this.docId,
        this.layerName,
        ref.pageObjectNumber,
        'index',
      );
      return AbortablePromise.run<AnnotationDeleteResult>(async (signal) => {
        const result = await this.http.patchJson(
          path,
          { ref, op: 'delete' },
          (raw) => AnnotationDeleteResultSchema.parse(raw),
          signal,
        );
        return this.absorbMutation(result);
      });
    }
    const stableKey = encodeStableIdKey(refToStableId(ref));
    const path = wirePaths.layerAnnotationByKey(
      this.docId,
      this.layerName,
      ref.pageObjectNumber,
      stableKey,
    );
    return AbortablePromise.run<AnnotationDeleteResult>(async (signal) => {
      const result = await this.http.deleteJson(
        path,
        (raw) => AnnotationDeleteResultSchema.parse(raw),
        signal,
      );
      return this.absorbMutation(result);
    });
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
    const path = wirePaths.layerPageAnnotationsMove(
      this.docId,
      this.layerName,
      this.pageObjectNumber,
    );
    return AbortablePromise.run<AnnotationMoveResult>(async (signal) => {
      const result = await this.http.postJson(
        path,
        { refs, toIndex },
        (raw) => AnnotationMoveResultSchema.parse(raw),
        signal,
      );
      return this.absorbMutation(result);
    });
  }

  private absorbMutation<T extends { meta: MutationMeta }>(result: T): T {
    this.manifest.apply(result.meta);
    return result;
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
