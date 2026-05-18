import {
  AbortError,
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  type DocumentAnnotationsService,
  type DocumentHandle,
  type DocumentPagesService,
  type MutationMeta,
  type PageHandle,
  type PageObjectNumber,
} from '@embedpdf/engine-core/runtime';
import {
  DEFAULT_LAYER_NAME,
  DocumentHeadSchema,
  DocumentManifestSchema,
  wirePaths,
  type DocumentHead,
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
  /** Absorb mutation-returned state/cache deltas when safe. */
  apply(meta: MutationMeta): void;
}

export class CloudDocumentHandle implements DocumentHandle {
  readonly id: string;
  readonly capabilities = {
    weakAnnotationEditSessions: 'required',
    pageEditSessions: 'unsupported',
  } as const;
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
  private manifestFloorVersion = 0;
  private pendingInitialHead: DocumentHead | null;

  private readonly manifestAccessor: ManifestAccessor;

  constructor(
    private readonly http: HttpClient,
    id: string,
    private readonly layerName: string = DEFAULT_LAYER_NAME,
    initialHead?: DocumentHead,
  ) {
    this.id = id;
    this.pendingInitialHead = initialHead ?? null;
    this.manifestAccessor = {
      get: (signal) => this.getManifest(signal),
      refresh: (signal) => this.refreshManifest(signal),
      apply: (meta) => this.absorbMutation(meta),
    };
    this.metadata = new CloudMetadataService(
      http,
      id,
      layerName,
      () => this.closed,
      this.manifestAccessor,
    );
    this.annotations = new CloudDocumentAnnotationsService(
      http,
      id,
      layerName,
      () => this.closed,
      this.manifestAccessor,
    );
    this.pages = new CloudDocumentPagesService(
      http,
      id,
      layerName,
      () => this.closed,
      this.manifestAccessor,
    );
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
    if (!this.inflightManifest) {
      this.startManifestFetch({ allowInitialHead: true });
    }
    const promise = this.inflightManifest;
    if (!promise) {
      throw new EngineError(
        EngineErrorCode.Unknown,
        `manifest fetch was not started for document ${this.id}`,
      );
    }
    return awaitSignal(promise, signal);
  }

  /**
   * Force re-fetch. Used by the transparent-retry path when a leaf
   * URL returns 404 (stale version). Replaces `manifestCache`
   * wholesale so the next `getManifest()` is a Map lookup.
   */
  async refreshManifest(signal: AbortSignal): Promise<DocumentManifest> {
    const promise = this.startManifestFetch({ allowInitialHead: false });
    return awaitSignal(promise, signal);
  }

  absorbMutation(meta: MutationMeta): void {
    const delta = meta.cacheDelta;
    if (delta) {
      this.manifestFloorVersion = Math.max(this.manifestFloorVersion, delta.docVersion);
    }
    this.inflightManifest = null;

    if (!this.manifestCache) return;
    if (delta) {
      if (delta.docVersion <= this.manifestCache.docVersion) return;
      if (delta.previousDocVersion !== this.manifestCache.docVersion) {
        this.manifestCache = null;
        return;
      }
    }

    const byPageObjectNumber = new Map(
      this.manifestCache.pages.map((page) => [page.state.pageObjectNumber, page]),
    );
    for (const pageState of meta.affectedPages) {
      const existing = byPageObjectNumber.get(pageState.pageObjectNumber);
      if (existing) {
        byPageObjectNumber.set(pageState.pageObjectNumber, {
          ...existing,
          state: pageState,
        });
      }
    }
    if (delta) {
      for (const page of delta.pages) {
        const existing = byPageObjectNumber.get(page.pageObjectNumber);
        if (existing) {
          byPageObjectNumber.set(page.pageObjectNumber, {
            ...existing,
            cache: page.cache,
          });
        }
      }
    }
    this.manifestCache = {
      ...this.manifestCache,
      docVersion: delta?.docVersion ?? this.manifestCache.docVersion,
      pages: Array.from(byPageObjectNumber.values()).sort(
        (a, b) => a.state.pageIndex - b.state.pageIndex,
      ),
    };
  }

  private startManifestFetch(opts: { allowInitialHead: boolean }): Promise<DocumentManifest> {
    const ctrl = new AbortController();
    const promise = this.fetchManifest(ctrl.signal, opts);
    this.inflightManifest = promise;
    promise
      .then((manifest) => {
        if (
          manifest.docVersion >= this.manifestFloorVersion &&
          (!this.manifestCache || manifest.docVersion >= this.manifestCache.docVersion)
        ) {
          this.manifestCache = manifest;
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.inflightManifest === promise) {
          this.inflightManifest = null;
        }
      });
    return promise;
  }

  private async fetchManifest(
    signal: AbortSignal,
    opts: { allowInitialHead: boolean },
  ): Promise<DocumentManifest> {
    if (this.closed) {
      throw new EngineError(EngineErrorCode.DocNotOpen, `document ${this.id} is closed`);
    }
    const head = opts.allowInitialHead ? this.consumeInitialHead() : null;
    if (head) {
      try {
        return await this.fetchManifestForHead(head, signal);
      } catch (err) {
        if (!EngineError.is(err, EngineErrorCode.NotFound)) throw err;
        // A mutation may have landed between open() and the first
        // manifest read. The seed is one-shot, so fall through to the
        // normal /head path and learn the current docVersion.
      }
    }

    // Refreshes and stale-seed recovery always re-fetch `/head` first
    // so we learn the current `docVersion`; chasing the manifest with
    // a stale `:D` would 404 by definition.
    const freshHead = await this.http.getJson(
      wirePaths.layerHead(this.id, this.layerName),
      (raw) => DocumentHeadSchema.parse(raw),
      signal,
    );
    return this.fetchManifestForHead(freshHead, signal);
  }

  private consumeInitialHead(): DocumentHead | null {
    const head = this.pendingInitialHead;
    this.pendingInitialHead = null;
    return head;
  }

  private fetchManifestForHead(head: DocumentHead, signal: AbortSignal): Promise<DocumentManifest> {
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
    return AbortablePromise.resolveValue<void>(undefined);
  }
}

function awaitSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new AbortError(signal.reason));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new AbortError(signal.reason));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (reason) => {
        signal.removeEventListener('abort', onAbort);
        reject(reason);
      },
    );
  });
}
