import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  type DocumentAnnotationsService,
  type DocumentHandle,
  type DocumentPagesService,
  type PageHandle,
  type PageObjectNumber,
} from '@embedpdf/engine-core/runtime';
import { wirePaths } from '@embedpdf/engine-core/wire';
import type { HttpClient } from '../transport/HttpClient';
import { CloudMetadataService } from './CloudMetadataService';
import { CloudDocumentAnnotationsService } from './CloudDocumentAnnotationsService';
import { CloudDocumentPagesService } from './CloudDocumentPagesService';
import { CloudPageHandle } from './CloudPageHandle';

export class CloudDocumentHandle implements DocumentHandle {
  readonly id: string;
  readonly metadata: CloudMetadataService;
  readonly annotations: DocumentAnnotationsService;
  readonly pages: DocumentPagesService;
  private closed = false;

  constructor(
    private readonly http: HttpClient,
    id: string,
  ) {
    this.id = id;
    this.metadata = new CloudMetadataService(http, id, () => this.closed);
    this.annotations = new CloudDocumentAnnotationsService(http, id, () => this.closed);
    this.pages = new CloudDocumentPagesService(http, id, () => this.closed);
  }

  page(pageObjectNumber: PageObjectNumber): PageHandle {
    return new CloudPageHandle(pageObjectNumber, -1, this.http, this.id, () => this.closed);
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
