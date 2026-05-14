import type { PageHandle, PageObjectNumber } from '@embedpdf/engine-core/runtime';
import type { HttpClient } from '../transport/HttpClient';
import { CloudPageAnnotationsService } from './CloudPageAnnotationsService';

export class CloudPageHandle implements PageHandle {
  readonly annotations: CloudPageAnnotationsService;

  constructor(
    readonly pageObjectNumber: PageObjectNumber,
    readonly pageIndex: number,
    http: HttpClient,
    docId: string,
    isClosed: () => boolean,
  ) {
    this.annotations = new CloudPageAnnotationsService(http, docId, pageObjectNumber, isClosed);
  }
}
