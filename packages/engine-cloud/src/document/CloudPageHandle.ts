import type { PageHandle, PageObjectNumber } from '@embedpdf/engine-core/runtime';
import type { HttpClient } from '../transport/HttpClient';
import { CloudPageAnnotationsService } from './CloudPageAnnotationsService';
import { CloudPageTextService } from './CloudPageTextService';
import type { ManifestAccessor } from './CloudDocumentHandle';

export class CloudPageHandle implements PageHandle {
  readonly annotations: CloudPageAnnotationsService;
  readonly text: CloudPageTextService;

  constructor(
    readonly pageObjectNumber: PageObjectNumber,
    readonly pageIndex: number,
    http: HttpClient,
    docId: string,
    isClosed: () => boolean,
    manifest: ManifestAccessor,
  ) {
    this.annotations = new CloudPageAnnotationsService(http, docId, pageObjectNumber, isClosed);
    this.text = new CloudPageTextService(http, docId, pageObjectNumber, isClosed, manifest);
  }
}
