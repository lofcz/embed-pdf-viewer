import type { PageHandle, PageObjectNumber } from '@embedpdf/engine-core/runtime';
import type { HttpClient } from '../transport/HttpClient';
import { CloudPageAnnotationsService } from './CloudPageAnnotationsService';
import { CloudPageGeometryService } from './CloudPageGeometryService';
import { CloudPageTextService } from './CloudPageTextService';
import type { ManifestAccessor } from './CloudDocumentHandle';

export class CloudPageHandle implements PageHandle {
  readonly annotations: CloudPageAnnotationsService;
  readonly text: CloudPageTextService;
  readonly geometry: CloudPageGeometryService;

  constructor(
    readonly pageObjectNumber: PageObjectNumber,
    readonly pageIndex: number,
    http: HttpClient,
    docId: string,
    layerName: string,
    isClosed: () => boolean,
    manifest: ManifestAccessor,
  ) {
    this.annotations = new CloudPageAnnotationsService(
      http,
      docId,
      layerName,
      pageObjectNumber,
      isClosed,
      manifest,
    );
    this.text = new CloudPageTextService(
      http,
      docId,
      layerName,
      pageObjectNumber,
      isClosed,
      manifest,
    );
    this.geometry = new CloudPageGeometryService(
      http,
      docId,
      layerName,
      pageObjectNumber,
      isClosed,
      manifest,
    );
  }
}
