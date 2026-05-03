import {
  AbortablePromise,
  AnnotationListPageSnapshotSchema,
  EngineError,
  EngineErrorCode,
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

  create(_draft: AnnotationDraft): AbortablePromise<AnnotationCreateResult> {
    return AbortablePromise.rejectReason(
      new EngineError(
        EngineErrorCode.NotImplemented,
        'annotation create is not implemented in this engine slice',
      ),
    );
  }

  update(_ref: AnnotationRef, _patch: AnnotationPatch): AbortablePromise<AnnotationUpdateResult> {
    return AbortablePromise.rejectReason(
      new EngineError(
        EngineErrorCode.NotImplemented,
        'annotation update is not implemented in this engine slice',
      ),
    );
  }

  delete(_ref: AnnotationRef): AbortablePromise<AnnotationDeleteResult> {
    return AbortablePromise.rejectReason(
      new EngineError(
        EngineErrorCode.NotImplemented,
        'annotation delete is not implemented in this engine slice',
      ),
    );
  }
}
