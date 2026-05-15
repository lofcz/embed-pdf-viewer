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
import {
  DEFAULT_LAYER_NAME,
  DocumentHeadSchema,
  DocumentManifestSchema,
  wirePaths,
  type DocumentManifest,
} from '@embedpdf/engine-core/wire';
import type { HttpClient } from '../transport/HttpClient';
import { CloudMetadataService } from './CloudMetadataService';
import { CloudDocumentAnnotationsService } from './CloudDocumentAnnotationsService';
import { CloudDocumentPagesService } from './CloudDocumentPagesService';
import { CloudPageHandle } from './CloudPageHandle';

/**
 * Read accessor handed to every `CloudPage…Service`. The closure
 * captures `this` so the services don't carry a direct reference
 * back to the document handle (smaller circular-ref surface, easier
 * to mock in unit tests).
 */
export interface ManifestAccessor {
  /** Cached manifest (cold-fetched once, kept across requests). */
  get(signal: AbortSignal): Promise<DocumentManifest>;
  /** Force re-fetch of `/head` + `/v:D/manifest`; replaces the cache. */
  refresh(signal: AbortSignal): Promise<DocumentManifest>;
}

export class CloudDocumentHandle implements DocumentHandle {
  readonly id: string;
  readonly metadata: CloudMetadataService;
  readonly annotations: DocumentAnnotationsService;
  readonly pages: DocumentPagesService;
  private closed = false;

  /**
   * Cached current manifest. Populated on first read by `getManifest`
   * (or any `page().*` call that needs to know a version). Replaced
   * wholesale on `refreshManifest`. Cleared on `close`.
   *
   * Memory model: one DocumentManifest per open handle. Per-page
   * version reads are O(pages.length) `.find(...)` lookups; if a
   * profiling pass ever shows that as hot, swap for a Map keyed by
   * `pageObjectNumber`. Today's documents are page-sparse so the
   * scan is cheaper than the hash overhead.
   */
  private manifestCache: DocumentManifest | null = null;
  private inflightManifest: Promise<DocumentManifest> | null = null;

  private readonly manifestAccessor: ManifestAccessor;

  constructor(
    private readonly http: HttpClient,
    id: string,
    private readonly layerName: string = DEFAULT_LAYER_NAME,
    private readonly useLayerRoutes: boolean = true,
  ) {
    this.id = id;
    this.manifestAccessor = {
      get: (signal) => this.getManifest(signal),
      refresh: (signal) => this.refreshManifest(signal),
    };
    this.metadata = new CloudMetadataService(
      http,
      id,
      layerName,
      () => this.closed,
      this.manifestAccessor,
      useLayerRoutes,
    );
    this.annotations = new CloudDocumentAnnotationsService(http, id, () => this.closed);
    this.pages = new CloudDocumentPagesService(http, id, () => this.closed);
  }

  page(pageObjectNumber: PageObjectNumber): PageHandle {
    return new CloudPageHandle(
      pageObjectNumber,
      -1,
      this.http,
      this.id,
      this.layerName,
      () => this.closed,
      this.manifestAccessor,
      this.useLayerRoutes,
    );
  }

  /**
   * Return the cached manifest, fetching cold-cache once if needed.
   * Concurrent callers share a single inflight request (singleflight)
   * so an N-page handle that opens N services in parallel still
   * triggers exactly one `/head` + `/v:D/manifest` round-trip.
   */
  async getManifest(signal: AbortSignal): Promise<DocumentManifest> {
    if (this.manifestCache) return this.manifestCache;
    if (this.inflightManifest) return this.inflightManifest;
    const promise = this.fetchManifest(signal);
    this.inflightManifest = promise;
    try {
      const manifest = await promise;
      this.manifestCache = manifest;
      return manifest;
    } finally {
      this.inflightManifest = null;
    }
  }

  /**
   * Force re-fetch. Used by the transparent-retry path when a leaf
   * URL returns 404 (stale version). Replaces `manifestCache`
   * wholesale so the next `getManifest()` is a Map lookup.
   */
  async refreshManifest(signal: AbortSignal): Promise<DocumentManifest> {
    const promise = this.fetchManifest(signal);
    this.inflightManifest = promise;
    try {
      const manifest = await promise;
      this.manifestCache = manifest;
      return manifest;
    } finally {
      this.inflightManifest = null;
    }
  }

  private async fetchManifest(signal: AbortSignal): Promise<DocumentManifest> {
    if (this.closed) {
      throw new EngineError(EngineErrorCode.DocNotOpen, `document ${this.id} is closed`);
    }
    if (!this.useLayerRoutes) {
      const head = await this.http.getJson(
        wirePaths.docHead(this.id),
        (raw) => DocumentHeadSchema.parse(raw),
        signal,
      );
      return this.http.getJson(
        wirePaths.docManifest(this.id, head.docVersion),
        (raw) => DocumentManifestSchema.parse(raw),
        signal,
      );
    }
    // Always re-fetch `/head` first so we learn the current
    // `docVersion`; chasing the manifest with a stale `:D` would
    // 404 by definition.
    const head = await this.http.getJson(
      wirePaths.layerHead(this.id, this.layerName),
      (raw) => DocumentHeadSchema.parse(raw),
      signal,
    );
    return this.http.getJson(
      wirePaths.layerManifest(this.id, this.layerName, head.docVersion),
      (raw) => DocumentManifestSchema.parse(raw),
      signal,
    );
  }

  close(): AbortablePromise<void> {
    if (this.closed) {
      return AbortablePromise.resolveValue<void>(undefined);
    }
    this.closed = true;
    this.manifestCache = null;
    this.inflightManifest = null;
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
