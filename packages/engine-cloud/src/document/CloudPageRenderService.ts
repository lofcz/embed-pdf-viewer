import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  createPageImageHandle,
  type PageImageHandle,
  type PageImageOptions,
  type PageImageResult,
  type PageNetworkRenderFormat,
  type PageObjectNumber,
  type PageRaster,
  type PageRenderOptions,
  type PageRenderService,
} from '@embedpdf/engine-core/runtime';
import { wirePaths } from '@embedpdf/engine-core/wire';
import type { HttpClient } from '../transport/HttpClient';
import type { ManifestAccessor } from './CloudDocumentHandle';

export class CloudPageRenderService implements PageRenderService {
  constructor(
    private readonly http: HttpClient,
    private readonly docId: string,
    private readonly layerName: string,
    private readonly pageObjectNumber: PageObjectNumber,
    private readonly isClosed: () => boolean,
    private readonly manifest: ManifestAccessor,
  ) {}

  image(options: PageImageOptions = {}): AbortablePromise<PageImageHandle> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<PageImageHandle>(async (signal) => {
      const format = normalizeFormat(options.format);
      const manifest = await this.manifest.get(signal);
      const page = manifest.pages.find((p) => p.state.pageObjectNumber === this.pageObjectNumber);
      if (!page) {
        throw new EngineError(
          EngineErrorCode.NotFound,
          `no page with object number ${this.pageObjectNumber} in document ${this.docId}`,
        );
      }
      const includeAnnotations = options.includeAnnotations ?? true;
      const path = includeAnnotations
        ? wirePaths.layerPageRenderWithAnnotations(
            this.docId,
            this.layerName,
            this.pageObjectNumber,
            page.cache.contentVersion,
            page.cache.annotationVersion,
            format,
          )
        : wirePaths.layerPageRender(
            this.docId,
            this.layerName,
            this.pageObjectNumber,
            page.cache.contentVersion,
            format,
          );
      const requestPath = `${path}${renderQuery(options)}`;
      return createCloudPageImageHandle(
        {
          pageState: page.state,
          format,
          contentType: `image/${format}`,
          source: { kind: 'url', url: this.http.absoluteUrl(requestPath) },
        },
        this.http,
        requestPath,
      );
    });
  }

  raw(_options?: PageRenderOptions): AbortablePromise<PageRaster> {
    return AbortablePromise.rejectReason(
      new EngineError(
        EngineErrorCode.NotImplemented,
        'render.raw() is not available in the cloud engine; use render.image()',
      ),
    );
  }
}

function createCloudPageImageHandle(
  result: PageImageResult,
  http: HttpClient,
  requestPath: string,
): PageImageHandle {
  return createPageImageHandle(result, {
    blob: (signal) => http.getBlob(requestPath, signal ?? new AbortController().signal),
  });
}

function normalizeFormat(format: PageImageOptions['format']): PageNetworkRenderFormat {
  if (format === undefined) return 'webp';
  if (format === 'png' || format === 'webp') return format;
  throw new EngineError(
    EngineErrorCode.InvalidArg,
    `cloud render.image() supports only "png" and "webp" (got "${format}")`,
  );
}

function renderQuery(options: PageImageOptions): string {
  const params = new URLSearchParams();
  if (options.viewport?.kind === 'width') params.set('width', String(options.viewport.width));
  if (options.viewport?.kind === 'scale') params.set('scale', String(options.viewport.scale ?? 1));
  if (options.target?.kind === 'rect') {
    const r = options.target.rect;
    params.set('rect', `${r.left},${r.top},${r.right},${r.bottom}`);
  }
  if (options.rotation !== undefined) params.set('rotation', String(options.rotation));
  if (options.background !== undefined) params.set('background', options.background);
  if (options.quality !== undefined) params.set('quality', String(options.quality));
  const query = params.toString();
  return query ? `?${query}` : '';
}
