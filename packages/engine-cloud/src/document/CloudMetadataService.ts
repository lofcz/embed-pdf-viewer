import {
  AbortablePromise,
  DocumentMetadataSchema,
  EngineError,
  EngineErrorCode,
  wirePaths,
  type DocumentMetadata,
  type MetadataService,
} from '@embedpdf/engine-core';
import type { HttpClient } from '../transport/HttpClient';

export class CloudMetadataService implements MetadataService {
  constructor(
    private readonly http: HttpClient,
    private readonly docId: string,
    private readonly isClosed: () => boolean,
  ) {}

  read(): AbortablePromise<DocumentMetadata> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<DocumentMetadata>(async (signal) =>
      this.http.getJson(
        wirePaths.metadata(this.docId),
        (raw) => DocumentMetadataSchema.parse(raw),
        signal,
      ),
    );
  }
}
