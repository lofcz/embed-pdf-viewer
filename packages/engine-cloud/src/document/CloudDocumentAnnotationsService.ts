import {
  AbortablePromise,
  AnnotationListPageSnapshotSchema,
  AnnotationListSnapshotAllPagesSchema,
  EngineError,
  EngineErrorCode,
  wirePaths,
  type AnnotationListPageSnapshot,
  type AnnotationListSnapshotAllPages,
  type DocumentAnnotationsService,
  type PageObjectNumber,
} from '@embedpdf/engine-core';
import type { HttpClient } from '../transport/HttpClient';

export class CloudDocumentAnnotationsService implements DocumentAnnotationsService {
  constructor(
    private readonly http: HttpClient,
    private readonly docId: string,
    private readonly isClosed: () => boolean,
  ) {}

  listRawAll(): AbortablePromise<AnnotationListSnapshotAllPages> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<AnnotationListSnapshotAllPages>(async (signal) =>
      this.http.getJson(
        wirePaths.annotationsRawAll(this.docId),
        (raw) => AnnotationListSnapshotAllPagesSchema.parse(raw),
        signal,
      ),
    );
  }

  listRaw(pageObjectNumber: PageObjectNumber): AbortablePromise<AnnotationListPageSnapshot> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<AnnotationListPageSnapshot>(async (signal) =>
      this.http.getJson(
        wirePaths.annotationsRawPage(this.docId, pageObjectNumber),
        (raw) => AnnotationListPageSnapshotSchema.parse(raw),
        signal,
      ),
    );
  }
}
