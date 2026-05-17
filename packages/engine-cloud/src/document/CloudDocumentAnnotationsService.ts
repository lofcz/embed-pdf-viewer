import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  type AnnotationListPageSnapshot,
  type AnnotationListSnapshotAllPages,
  type DocumentAnnotationsService,
  type PageObjectNumber,
} from '@embedpdf/engine-core/runtime';
import { AnnotationListPageSnapshotSchema, wirePaths } from '@embedpdf/engine-core/wire';
import type { HttpClient } from '../transport/HttpClient';
import type { ManifestAccessor } from './CloudDocumentHandle';

export class CloudDocumentAnnotationsService implements DocumentAnnotationsService {
  constructor(
    private readonly http: HttpClient,
    private readonly docId: string,
    private readonly layerName: string,
    private readonly isClosed: () => boolean,
    private readonly manifest: ManifestAccessor,
  ) {}

  listRawAll(): AbortablePromise<AnnotationListSnapshotAllPages> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<AnnotationListSnapshotAllPages>(async (signal) => {
      const manifest = await this.manifest.get(signal);
      const pages = await Promise.all(
        manifest.pages.map((page) => this.readCurrentPage(page.pageObjectNumber, signal)),
      );
      return { pages };
    });
  }

  listRaw(pageObjectNumber: PageObjectNumber): AbortablePromise<AnnotationListPageSnapshot> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<AnnotationListPageSnapshot>((signal) =>
      this.readCurrentPage(pageObjectNumber, signal),
    );
  }

  private async readCurrentPage(
    pageObjectNumber: PageObjectNumber,
    signal: AbortSignal,
  ): Promise<AnnotationListPageSnapshot> {
    return this.http.getJson(
      wirePaths.layerPageAnnotationsCurrent(this.docId, this.layerName, pageObjectNumber),
      (raw) => AnnotationListPageSnapshotSchema.parse(raw),
      signal,
    );
  }
}
