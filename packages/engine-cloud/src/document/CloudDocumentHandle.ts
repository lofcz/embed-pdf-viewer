import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  wirePaths,
  type DocumentHandle,
} from '@embedpdf/engine-core';
import type { HttpClient } from '../transport/HttpClient';
import { CloudMetadataService } from './CloudMetadataService';

export class CloudDocumentHandle implements DocumentHandle {
  readonly id: string;
  readonly metadata: CloudMetadataService;
  private closed = false;

  constructor(
    private readonly http: HttpClient,
    id: string,
  ) {
    this.id = id;
    this.metadata = new CloudMetadataService(http, id, () => this.closed);
  }

  close(): AbortablePromise<void> {
    if (this.closed) {
      return AbortablePromise.resolveValue<void>(undefined);
    }
    this.closed = true;
    return AbortablePromise.run<void>(async (signal) => {
      try {
        await this.http.deleteEmpty(wirePaths.document(this.id), signal);
      } catch (err) {
        if (EngineError.is(err, EngineErrorCode.NotFound)) return;
        throw err;
      }
    });
  }
}
