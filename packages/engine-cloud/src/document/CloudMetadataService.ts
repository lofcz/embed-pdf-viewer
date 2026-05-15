import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  type DocumentMetadata,
  type MetadataService,
} from '@embedpdf/engine-core/runtime';
import { DocumentMetadataSchema, wirePaths } from '@embedpdf/engine-core/wire';
import type { HttpClient } from '../transport/HttpClient';
import type { ManifestAccessor } from './CloudDocumentHandle';

export class CloudMetadataService implements MetadataService {
  constructor(
    private readonly http: HttpClient,
    private readonly docId: string,
    private readonly layerName: string,
    private readonly isClosed: () => boolean,
    private readonly manifest: ManifestAccessor,
    private readonly useLayerRoutes: boolean,
  ) {}

  read(): AbortablePromise<DocumentMetadata> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    if (!this.useLayerRoutes) {
      return AbortablePromise.run<DocumentMetadata>(async (signal) =>
        this.http.getJson(
          wirePaths.metadata(this.docId),
          (raw) => DocumentMetadataSchema.parse(raw),
          signal,
        ),
      );
    }
    return AbortablePromise.run<DocumentMetadata>(async (signal) => {
      const buildPath = async (s: AbortSignal): Promise<string> => {
        const manifest = await this.manifest.get(s);
        return wirePaths.layerMetadata(this.docId, this.layerName, manifest.docVersion);
      };
      return this.http.getJsonWithRefresh(
        buildPath,
        (raw) => DocumentMetadataSchema.parse(raw),
        async (s) => {
          await this.manifest.refresh(s);
        },
        signal,
      );
    });
  }
}
