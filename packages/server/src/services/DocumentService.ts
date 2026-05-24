import { createHash } from 'node:crypto';
import {
  EngineError,
  EngineErrorCode,
  wirePack,
  type DocumentMetadata,
  type PageState,
  type WorkerJobId,
} from '@embedpdf/engine-core/runtime';
import type { ManifestPage } from '@embedpdf/engine-core/wire';
import type { DocumentsRepo, DocumentRow } from '../db/repos/documents.repo';
import type { BaseFileCache, LocalFileHandle } from '../storage/BaseFileCache';
import type { ObjectStore } from '../storage/ObjectStore';
import { StorageKeys } from '../storage/keys';
import type { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import type { LayerStateService } from './LayerStateService';

/**
 * Public head shape returned by `GET /v1/docs/:docId/head`.
 *
 * `docVersion` is the single monotonic integer per document — bumps
 * on ANY mutation that could change the manifest's content (page
 * list, per-page content, per-page annotations, per-page weak-flag).
 * That makes `/manifest@docVersion=N` content-addressed and CDN-cacheable for
 * a year. Phase 4 hard-codes it to `1`; Phase 5's mutation handler
 * is what actually bumps it.
 */
export interface DocumentHead {
  id: string;
  baseSha: string;
  pageCount: number;
  storageSizeBytes: number;
  /** Cache-busting integer; bumps on EVERY content-changing mutation. */
  docVersion: number;
  /** Lifecycle state, exposed so the SDK can render "deleting" / "failed" UI. */
  state: DocumentRow['state'];
}

/**
 * Versioned manifest. Each page reports the cache-busting integers
 * that drive `/pages/:pon/text@contentVersion=N` and `/pages/:pon/annotations@annotationVersion=N`,
 * so the SDK can build leaf URLs without further round-trips.
 *
 * Hard-coded `(contentVersion: 1, annotationVersion: 1)` in Phase 4.
 * `hasWeakAnnotations` is still computed from a real annotation scan before
 * being published, so the cacheable manifest never collapses unknown to false.
 * Phase 5 swaps the scan for a `LayerPagesRepo.find(docId)` lookup.
 */
export interface DocumentManifest {
  docVersion: number;
  baseSha: string;
  pages: ManifestPage[];
}

export interface DocumentServiceOptions {
  documents: DocumentsRepo;
  cache: BaseFileCache;
  storage: ObjectStore;
  pool: WorkerThreadPool;
  layerState: LayerStateService;
}

export interface OpenContext {
  tenantId: string;
  sub: string;
}

/**
 * Orchestrates a doc-scoped request from the moment the SDK calls
 * `/head` until the worker holds the PDFium document open.
 *
 * Pipeline for a cold-cache open:
 *   1. Lookup `documents` row, verify tenant ownership + `ready` state.
 *   2. Acquire a refcounted file handle from `BaseFileCache`.
 *      Concurrent acquirers of the same `base_sha` share one
 *      materialisation; concurrent acquirers of the same `docId` share
 *      one `WorkerThreadPool.runOpen` via this service's own
 *      singleflight map.
 *   3. Pass the materialised path to the worker via `pool.runOpen`
 *      with sticky-by-baseSha routing. The worker opens PDFium through
 *      file-backed FPDF_FILEACCESS, so Node never copies the full base
 *      into JS or worker memory.
 *   4. Keep the cache handle pinned while the worker session is open.
 *      Release it on explicit close, pool eviction, or app shutdown.
 *   5. Cache the head data so warm `/head` is a single Map lookup.
 *
 * Eviction model: when the pool evicts a `docId` from a worker slot
 * (slot-cap LRU), `onPoolEvict(evt)` flushes the head cache. The next
 * request lazily re-opens.
 */
export class DocumentService {
  private readonly documents: DocumentsRepo;
  private readonly cache: BaseFileCache;
  private readonly storage: ObjectStore;
  private readonly pool: WorkerThreadPool;
  private readonly layerState: LayerStateService;
  private readonly heads = new Map<string, DocumentHead>();
  private readonly opens = new Map<string, Promise<DocumentHead>>();
  private readonly baseHandles = new Map<string, LocalFileHandle>();
  private readonly openedLayerSessions = new Set<string>();
  private readonly layerOpens = new Map<string, Promise<void>>();

  constructor(opts: DocumentServiceOptions) {
    this.documents = opts.documents;
    this.cache = opts.cache;
    this.storage = opts.storage;
    this.pool = opts.pool;
    this.layerState = opts.layerState;
  }

  /**
   * Idempotent open. Returns a `DocumentHead` for `docId`. Triggers a
   * cache fetch + worker open on the first call; subsequent calls
   * for the same docId resolve from the in-memory head cache.
   *
   * Concurrent first-callers share one open via singleflight.
   */
  async openOnPool(ctx: OpenContext, docId: string): Promise<DocumentHead> {
    const cached = this.heads.get(docId);
    if (cached) return cached;
    const inflight = this.opens.get(docId);
    if (inflight) return inflight;
    const promise = this.doOpen(ctx, docId);
    this.opens.set(docId, promise);
    try {
      const head = await promise;
      this.heads.set(docId, head);
      return head;
    } finally {
      this.opens.delete(docId);
    }
  }

  private async doOpen(ctx: OpenContext, docId: string): Promise<DocumentHead> {
    const row = await this.documents.requireOwned(docId, ctx.tenantId);
    if (row.state === 'pending') {
      throw new EngineError(
        EngineErrorCode.DocOpenFailed,
        `document is still pending upload: ${docId}`,
      );
    }
    if (row.state === 'failed') {
      throw new EngineError(
        EngineErrorCode.DocOpenFailed,
        `document failed at commit: ${docId} (${row.failureReason ?? 'unknown'})`,
      );
    }
    if (row.state === 'deleting') {
      throw new EngineError(EngineErrorCode.NotFound, `document is being deleted: ${docId}`);
    }
    if (row.state !== 'ready') {
      throw new EngineError(EngineErrorCode.DocOpenFailed, `document not ready: ${row.state}`);
    }
    if (!row.baseSha) {
      // Bug-class assertion: a `ready` doc must have a base_sha (the
      // commit path sets both atomically). If we see this, the DB row
      // is corrupted — fail loudly so it shows up in audit.
      throw new EngineError(
        EngineErrorCode.DocOpenFailed,
        `document is ready but has no base_sha: ${docId}`,
      );
    }

    let handle: LocalFileHandle | null = await this.cache.acquire({
      sha: row.baseSha,
      key: StorageKeys.basePdf(row.tenantId, row.id),
    });
    try {
      const baseSha = row.baseSha;
      const build = (jobId: WorkerJobId) =>
        wirePack({
          kind: 'open.layerFileBase' as const,
          jobId,
          docId,
          baseKey: baseSha,
          basePath: handle!.path,
          layer: { kind: 'fresh' as const },
          password: null,
        });
      const result = await this.pool.runOpen(docId, baseSha, build);
      if (result.tag !== 'open') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected open payload: ${result.tag}`);
      }
      const head: DocumentHead = {
        id: docId,
        baseSha,
        pageCount: row.pageCount ?? 0,
        storageSizeBytes: row.storageSizeBytes ?? 0,
        docVersion: row.docVersion,
        state: row.state,
      };
      this.replaceBaseHandle(docId, handle);
      handle = null;
      return head;
    } finally {
      handle?.release();
    }
  }

  /**
   * Page list manifest for the open document. Triggers an open if
   * not already cached. The manifest is the smallest piece of data
   * the SDK needs to render the page list / progressively request
   * page renders.
   */
  async getManifest(ctx: OpenContext, docId: string): Promise<DocumentManifest> {
    const head = await this.openOnPool(ctx, docId);
    const pages = await this.layerState.ensureBasePages(docId, () =>
      this.loadDurableBasePageStates(docId),
    );
    return this.layerState.buildBaseManifest(head, pages);
  }

  async getLayerHead(ctx: OpenContext, docId: string, layerName: string): Promise<DocumentHead> {
    const head = await this.openOnPool(ctx, docId);
    const layer = await this.layerState.repos.layers.findByDocAndName(docId, layerName);
    return layer ? { ...head, docVersion: layer.docVersion } : head;
  }

  /**
   * Build a layer-scoped manifest from durable state.
   *
   * A layer that has never been created/mutated has no DB rows by design,
   * so it reads as the immutable base view without creating layer state.
   */
  async getLayerManifest(
    ctx: OpenContext,
    docId: string,
    layerName: string,
  ): Promise<DocumentManifest> {
    const head = await this.openOnPool(ctx, docId);
    const layer = await this.layerState.repos.layers.findByDocAndName(docId, layerName);
    if (!layer) {
      const pages = await this.layerState.ensureBasePages(docId, () =>
        this.loadDurableBasePageStates(docId),
      );
      return this.layerState.buildLayerManifest(docId, head.baseSha, layerName, head, pages);
    }

    await this.layerState.ensureBasePages(docId, () => this.loadDurableBasePageStates(docId));
    const pages = await this.layerState.ensureLayerPagesFromBase({ layerId: layer.id, docId });
    return this.layerState.buildLayerManifest(docId, head.baseSha, layerName, layer, pages);
  }

  async ensureLayerOnPool(ctx: OpenContext, docId: string, layerName: string): Promise<void> {
    const key = `${docId}::${layerName}`;
    if (this.openedLayerSessions.has(key)) return;
    const existing = this.layerOpens.get(key);
    if (existing) return existing;

    const promise = this.openLayerOnPool(ctx, docId, layerName)
      .then(() => {
        this.openedLayerSessions.add(key);
      })
      .finally(() => {
        this.layerOpens.delete(key);
      });
    this.layerOpens.set(key, promise);
    return promise;
  }

  async readLayerMetadata(
    ctx: OpenContext,
    docId: string,
    layerName: string,
    signal?: AbortSignal,
  ): Promise<DocumentMetadata> {
    await this.ensureLayerOnPool(ctx, docId, layerName);
    const build = (jobId: WorkerJobId) =>
      wirePack({ kind: 'metadata.read' as const, jobId, docId, layerName });
    const result = await this.pool.run(docId, build, signal);
    if (result.tag !== 'metadata.read') {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `unexpected metadata payload: ${result.tag}`,
      );
    }
    return result.metadata;
  }

  /**
   * Pre-warm hook for the `/v1/warm` route. Forces the materialise +
   * worker open before the first user request lands, so the user's
   * first call is the warm path (~microseconds).
   */
  async warm(ctx: OpenContext, docId: string): Promise<DocumentHead> {
    return this.openOnPool(ctx, docId);
  }

  /**
   * Pool-eviction callback. Wired into `WorkerThreadPool.onEvict`;
   * when the pool drops a doc from a slot, the cached head is no
   * longer authoritative (the next request must trigger a re-open).
   */
  onPoolEvict(evt: { docId: string }): void {
    this.heads.delete(evt.docId);
    this.forgetLayerSessions(evt.docId);
    this.releaseBaseHandle(evt.docId);
  }

  /**
   * Explicit close: tear down the worker-side handle and drop the
   * head cache. Currently unused on the route side — Phase 3 leaves
   * close to the pool's eviction policy — but exposed for tests and
   * for future graceful-shutdown flows.
   */
  async close(docId: string): Promise<void> {
    this.heads.delete(docId);
    try {
      await this.pool.close(docId);
    } catch {
      // close is best-effort; pool may not know about this docId
      // anymore (already evicted), in which case it returns null and
      // we treat that as success.
    } finally {
      this.forgetLayerSessions(docId);
      this.releaseBaseHandle(docId);
    }
  }

  releaseAllBaseHandles(): void {
    for (const docId of Array.from(this.baseHandles.keys())) {
      this.releaseBaseHandle(docId);
    }
  }

  /** Diagnostic snapshot for tests + ops dashboards. */
  stats(): { openHeads: number; inflightOpens: number; pinnedBaseFiles: number } {
    return {
      openHeads: this.heads.size,
      inflightOpens: this.opens.size,
      pinnedBaseFiles: this.baseHandles.size,
    };
  }

  private async loadDurableBasePageStates(docId: string): Promise<PageState[]> {
    const annotationsBuild = (jobId: WorkerJobId) =>
      wirePack({ kind: 'annotations.listRawAll' as const, jobId, docId });
    const annotationsResult = await this.pool.run(docId, annotationsBuild);
    if (annotationsResult.tag !== 'annotations.listRawAll') {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `unexpected manifest annotation payload: ${annotationsResult.tag}`,
      );
    }
    return annotationsResult.snapshot.pages.map((page) => page.pageState);
  }

  private async openLayerOnPool(ctx: OpenContext, docId: string, layerName: string): Promise<void> {
    const head = await this.openOnPool(ctx, docId);
    const handle = this.baseHandles.get(docId);
    if (!handle) {
      throw new EngineError(
        EngineErrorCode.DocOpenFailed,
        `base file handle missing for open document: ${docId}`,
      );
    }

    const layer = await this.layerState.repos.layers.findByDocAndName(docId, layerName);
    const layerSource = layer ? await this.readLayerOpenSource(layer) : { kind: 'fresh' as const };
    const build = (jobId: WorkerJobId) => {
      const request = {
        kind: 'open.layerFileBase' as const,
        jobId,
        docId,
        layerName,
        baseKey: head.baseSha,
        basePath: handle.path,
        layer: layerSource,
        password: null,
      };
      return layerSource.kind === 'artifact'
        ? wirePack(request, [layerSource.bytes])
        : wirePack(request);
    };
    const result = await this.pool.run(docId, build);
    if (result.tag !== 'open') {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `unexpected layer open payload: ${result.tag}`,
      );
    }
  }

  private async readLayerOpenSource(layer: {
    currentVersion: number;
    currentArtifactKey: string | null;
    currentArtifactSha: string | null;
    currentArtifactSize: number | null;
  }): Promise<{ kind: 'fresh' } | { kind: 'artifact'; bytes: ArrayBuffer }> {
    if (layer.currentVersion === 0 && !layer.currentArtifactKey) {
      return { kind: 'fresh' };
    }
    if (!layer.currentArtifactKey) {
      throw new EngineError(
        EngineErrorCode.DocOpenFailed,
        `layer version ${layer.currentVersion} is missing its artifact key`,
      );
    }

    const bytes = await this.storage.get(layer.currentArtifactKey);
    if (!bytes) {
      throw new EngineError(
        EngineErrorCode.DocOpenFailed,
        `layer artifact not found: ${layer.currentArtifactKey}`,
      );
    }
    if (layer.currentArtifactSize !== null && bytes.byteLength !== layer.currentArtifactSize) {
      throw new EngineError(
        EngineErrorCode.MalformedPdf,
        `layer artifact size mismatch for ${layer.currentArtifactKey}`,
      );
    }
    if (layer.currentArtifactSha) {
      const actualSha = createHash('sha256').update(bytes).digest('hex');
      if (actualSha !== layer.currentArtifactSha) {
        throw new EngineError(
          EngineErrorCode.MalformedPdf,
          `layer artifact sha mismatch for ${layer.currentArtifactKey}`,
        );
      }
    }

    return { kind: 'artifact', bytes: toOwnedArrayBuffer(bytes) };
  }

  private forgetLayerSessions(docId: string): void {
    for (const key of Array.from(this.openedLayerSessions)) {
      if (key.startsWith(`${docId}::`)) this.openedLayerSessions.delete(key);
    }
    for (const key of Array.from(this.layerOpens.keys())) {
      if (key.startsWith(`${docId}::`)) this.layerOpens.delete(key);
    }
  }

  private replaceBaseHandle(docId: string, handle: LocalFileHandle): void {
    this.releaseBaseHandle(docId);
    this.baseHandles.set(docId, handle);
  }

  private releaseBaseHandle(docId: string): void {
    const handle = this.baseHandles.get(docId);
    if (!handle) return;
    this.baseHandles.delete(docId);
    handle.release();
  }
}

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
