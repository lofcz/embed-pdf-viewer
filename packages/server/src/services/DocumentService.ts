import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EngineError,
  EngineErrorCode,
  securityStateFromProbe,
  wirePack,
  type DocumentSecurityState,
  type DocumentMetadata,
  type DocumentSecurityProbeInfo,
  type PageState,
  type PdfSaveMode,
  type WorkerJobId,
} from '@embedpdf/engine-core/runtime';
import type { ManifestPage } from '@embedpdf/engine-core/wire';
import type { DocumentsRepo, DocumentRow } from '../db/repos/documents.repo';
import type { PdfPasswordVerificationsRepo } from '../db/repos/pdf_password_verifications.repo';
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
  storageSizeBytes: number;
  /** Cache-busting integer; bumps on EVERY content-changing mutation. */
  docVersion: number;
  /** Lifecycle state, exposed so the SDK can render "deleting" / "failed" UI. */
  state: DocumentRow['state'];
  encryption: {
    state: DocumentRow['security']['encryptionState'];
    requiresPassword: boolean | null;
  };
  permissions: {
    known: boolean;
    bits: number | null;
    allAllowed: boolean | null;
    openedAs: NonNullable<DocumentRow['security']['pdfOpenedAs']> | null;
    securityHandlerRevision: number | null;
    canUpgradeToOwner: boolean;
  };
  access: {
    required: boolean;
    reasons: Array<'password' | 'cdn' | 'permissions-unknown'>;
    endpoint?: string;
  };
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
  passwordVerifications?: PdfPasswordVerificationsRepo;
}

export interface OpenContext {
  tenantId: string;
  sub: string;
}

export interface SavedPdfFile {
  path: string;
  size: number;
  cleanup(): Promise<void>;
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
  private readonly passwordVerifications: PdfPasswordVerificationsRepo | null;
  private readonly heads = new Map<string, DocumentHead>();
  private readonly opens = new Map<string, Promise<DocumentHead>>();
  private readonly baseHandles = new Map<string, LocalFileHandle>();
  private readonly layerArtifactHandles = new Map<string, LocalFileHandle>();
  private readonly openedLayerSessions = new Set<string>();
  private readonly layerOpens = new Map<string, Promise<void>>();

  constructor(opts: DocumentServiceOptions) {
    this.documents = opts.documents;
    this.cache = opts.cache;
    this.storage = opts.storage;
    this.pool = opts.pool;
    this.layerState = opts.layerState;
    this.passwordVerifications = opts.passwordVerifications ?? null;
  }

  /**
   * Idempotent open. Returns a `DocumentHead` for `docId`. Triggers a
   * cache fetch + worker open on the first call; subsequent calls
   * for the same docId resolve from the in-memory head cache.
   *
   * Concurrent first-callers share one open via singleflight.
   */
  async openOnPool(
    ctx: OpenContext,
    docId: string,
    password: string | null = null,
  ): Promise<DocumentHead> {
    const cached = this.heads.get(docId);
    if (cached) return cached;
    const inflight = this.opens.get(docId);
    if (inflight) return inflight;
    const promise = this.doOpen(ctx, docId, password);
    this.opens.set(docId, promise);
    try {
      const head = await promise;
      this.heads.set(docId, head);
      return head;
    } finally {
      this.opens.delete(docId);
    }
  }

  /**
   * Cheap DB-only head. It intentionally does not materialise the base
   * or open PDFium; ingestion owns the best-effort security probe, and
   * manifest/page endpoints own page discovery.
   */
  async getHead(ctx: OpenContext, docId: string): Promise<DocumentHead> {
    const row = await this.requireReadyRow(ctx, docId);
    const head = buildHead(row);
    void this.warm(ctx, docId).catch(() => undefined);
    return head;
  }

  private async doOpen(
    ctx: OpenContext,
    docId: string,
    password: string | null = null,
  ): Promise<DocumentHead> {
    const row = await this.requireReadyRow(ctx, docId);
    const baseSha = requireBaseSha(row);

    let handle: LocalFileHandle | null = await this.cache.acquire({
      sha: baseSha,
      key: StorageKeys.basePdf(row.tenantId, row.id),
    });
    try {
      const build = (jobId: WorkerJobId) =>
        wirePack({
          kind: 'open.layerFileBase' as const,
          jobId,
          docId,
          baseKey: baseSha,
          basePath: handle!.path,
          layer: { kind: 'fresh' as const },
          password,
        });
      const result = await this.pool.runOpen(docId, baseSha, build);
      if (result.tag !== 'open') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected open payload: ${result.tag}`);
      }
      const head = buildHead(row);
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
    const head = await this.getHead(ctx, docId);
    void this.ensureLayerOnPool(ctx, docId, layerName).catch(() => undefined);
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

  async ensureLayerOnPool(
    ctx: OpenContext,
    docId: string,
    layerName: string,
    password: string | null = null,
  ): Promise<void> {
    const key = `${docId}::${layerName}`;
    if (this.openedLayerSessions.has(key)) return;
    const existing = this.layerOpens.get(key);
    if (existing) return existing;

    const promise = this.openLayerOnPool(ctx, docId, layerName, password)
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

  async unlockLayerAccess(
    ctx: OpenContext,
    docId: string,
    layerName: string,
    input: { password?: string | null; mode?: 'any' | 'owner' },
  ): Promise<{ security: DocumentSecurityState; probe: DocumentSecurityProbeInfo }> {
    const row = await this.requireReadyRow(ctx, docId);
    const baseSha = requireBaseSha(row);
    const password = input.password ?? null;
    const mode = input.mode ?? 'any';

    if (row.security.encryptionRequiresPassword === true && !password) {
      throw new EngineError(EngineErrorCode.DocPasswordRequired, 'document password required');
    }

    if (password && this.passwordVerifications) {
      const cached = await this.passwordVerifications.findValid({
        tenantId: ctx.tenantId,
        docId,
        baseSha,
        securityFingerprint: securityFingerprint(row),
        password,
      });
      if (cached) {
        if (mode === 'owner' && cached.openedAs !== 'owner') {
          throw new EngineError(EngineErrorCode.DocPasswordIncorrect, 'owner password required');
        }
        const probe = securityInfoFromCachedVerification(cached);
        return {
          probe,
          security: securityStateFromProbe(probe, { accessEndpoint: '/v1/access' }),
        };
      }
    }

    await this.ensureLayerOnPool(ctx, docId, layerName, password);
    const build = (jobId: WorkerJobId) =>
      wirePack({
        kind: 'document.checkPasswordPermissions' as const,
        jobId,
        docId,
        layerName,
        password: password ?? '',
        mode,
      });
    const result = await this.pool.run(docId, build);
    if (result.tag !== 'document.checkPasswordPermissions') {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `unexpected security payload: ${result.tag}`,
      );
    }

    if (password && this.passwordVerifications && result.security.pdfPermissionsBits !== null) {
      await this.passwordVerifications.upsert(
        {
          tenantId: ctx.tenantId,
          docId,
          baseSha,
          securityFingerprint: securityFingerprint(row),
          password,
        },
        {
          openedAs: result.security.pdfOpenedAs ?? 'none',
          pdfPermissionsBits: result.security.pdfPermissionsBits,
          pdfPermissionsAllAllowed: result.security.pdfPermissionsAllAllowed ?? false,
          securityHandlerRevision: result.security.securityHandlerRevision,
        },
      );
    }

    return {
      probe: result.security,
      security: securityStateFromProbe(result.security, { accessEndpoint: '/v1/access' }),
    };
  }

  private async requireReadyRow(ctx: OpenContext, docId: string): Promise<DocumentRow> {
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
      throw new EngineError(
        EngineErrorCode.DocOpenFailed,
        `document is ready but has no base_sha: ${docId}`,
      );
    }
    return row;
  }

  async saveLayerDownloadToTemp(
    ctx: OpenContext,
    docId: string,
    layerName: string,
    mode: PdfSaveMode,
    signal?: AbortSignal,
  ): Promise<SavedPdfFile> {
    await this.ensureLayerOnPool(ctx, docId, layerName);
    const dir = await mkdtemp(join(tmpdir(), 'embedpdf-download-'));
    const path = join(dir, `${safeFilePart(docId)}-${safeFilePart(layerName)}.pdf`);

    try {
      // Cloud downloads use file-backed FPDF_FILEWRITE so large PDFs never cross
      // the worker boundary as ArrayBuffers. Fastify streams this completed temp
      // file and the returned cleanup callback removes the whole temp directory.
      const build = (jobId: WorkerJobId) =>
        wirePack({
          kind: 'document.saveFile' as const,
          jobId,
          docId,
          layerName,
          mode,
          path,
        });
      const result = await this.pool.run(docId, build, signal);
      if (result.tag !== 'document.saveFile') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected save payload: ${result.tag}`);
      }
      if (result.path !== path) {
        throw new EngineError(
          EngineErrorCode.WireFormat,
          `worker saved unexpected path: ${result.path}`,
        );
      }

      const info = await stat(path);
      if (!info.isFile() || info.size <= 0) {
        throw new EngineError(EngineErrorCode.DocOpenFailed, `saved PDF is empty: ${docId}`);
      }

      let cleaned = false;
      return {
        path,
        size: info.size,
        async cleanup() {
          if (cleaned) return;
          cleaned = true;
          await rm(dir, { recursive: true, force: true });
        },
      };
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err;
    }
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
    for (const key of Array.from(this.layerArtifactHandles.keys())) {
      this.releaseLayerArtifactHandle(key);
    }
  }

  /** Diagnostic snapshot for tests + ops dashboards. */
  stats(): {
    openHeads: number;
    inflightOpens: number;
    pinnedBaseFiles: number;
    pinnedLayerArtifacts: number;
  } {
    return {
      openHeads: this.heads.size,
      inflightOpens: this.opens.size,
      pinnedBaseFiles: this.baseHandles.size,
      pinnedLayerArtifacts: this.layerArtifactHandles.size,
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

  private async openLayerOnPool(
    ctx: OpenContext,
    docId: string,
    layerName: string,
    password: string | null = null,
  ): Promise<void> {
    const head = await this.openOnPool(ctx, docId, password);
    const handle = this.baseHandles.get(docId);
    if (!handle) {
      throw new EngineError(
        EngineErrorCode.DocOpenFailed,
        `base file handle missing for open document: ${docId}`,
      );
    }

    const sessionKey = layerSessionKey(docId, layerName);
    const layer = await this.layerState.repos.layers.findByDocAndName(docId, layerName);
    let layerHandle: LocalFileHandle | null = null;
    const layerOpen = layer
      ? await this.readLayerOpenSource(layer)
      : { source: { kind: 'fresh' as const }, handle: null };
    layerHandle = layerOpen.handle;
    const layerSource = layerOpen.source;
    const build = (jobId: WorkerJobId) => {
      const request = {
        kind: 'open.layerFileBase' as const,
        jobId,
        docId,
        layerName,
        baseKey: head.baseSha,
        basePath: handle.path,
        layer: layerSource,
        password,
      };
      return wirePack(request);
    };
    try {
      const result = await this.pool.run(docId, build);
      if (result.tag !== 'open') {
        throw new EngineError(
          EngineErrorCode.WireFormat,
          `unexpected layer open payload: ${result.tag}`,
        );
      }
      this.replaceLayerArtifactHandle(sessionKey, layerHandle);
      layerHandle = null;
    } finally {
      layerHandle?.release();
    }
  }

  private async readLayerOpenSource(layer: {
    currentVersion: number;
    currentArtifactKey: string | null;
    currentArtifactSha: string | null;
    currentArtifactSize: number | null;
  }): Promise<{
    source: { kind: 'fresh' } | { kind: 'artifact-file'; path: string };
    handle: LocalFileHandle | null;
  }> {
    if (layer.currentVersion === 0 && !layer.currentArtifactKey) {
      return { source: { kind: 'fresh' }, handle: null };
    }
    if (!layer.currentArtifactKey) {
      throw new EngineError(
        EngineErrorCode.DocOpenFailed,
        `layer version ${layer.currentVersion} is missing its artifact key`,
      );
    }
    if (!layer.currentArtifactSha) {
      throw new EngineError(
        EngineErrorCode.DocOpenFailed,
        `layer version ${layer.currentVersion} is missing its artifact sha`,
      );
    }

    const handle = await this.cache.acquire({
      sha: layer.currentArtifactSha,
      key: layer.currentArtifactKey,
    });
    if (layer.currentArtifactSize !== null && handle.size !== layer.currentArtifactSize) {
      handle.release();
      throw new EngineError(
        EngineErrorCode.MalformedPdf,
        `layer artifact size mismatch for ${layer.currentArtifactKey}`,
      );
    }

    return { source: { kind: 'artifact-file', path: handle.path }, handle };
  }

  private forgetLayerSessions(docId: string): void {
    for (const key of Array.from(this.openedLayerSessions)) {
      if (key.startsWith(`${docId}::`)) this.openedLayerSessions.delete(key);
    }
    for (const key of Array.from(this.layerArtifactHandles.keys())) {
      if (key.startsWith(`${docId}::`)) this.releaseLayerArtifactHandle(key);
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

  private replaceLayerArtifactHandle(key: string, handle: LocalFileHandle | null): void {
    this.releaseLayerArtifactHandle(key);
    if (handle) this.layerArtifactHandles.set(key, handle);
  }

  private releaseLayerArtifactHandle(key: string): void {
    const handle = this.layerArtifactHandles.get(key);
    if (!handle) return;
    this.layerArtifactHandles.delete(key);
    handle.release();
  }
}

function layerSessionKey(docId: string, layerName: string): string {
  return `${docId}::${layerName}`;
}

function buildHead(row: DocumentRow): DocumentHead {
  const baseSha = requireBaseSha(row);
  const permissions = {
    known: row.security.pdfPermissionsBits !== null,
    bits: row.security.pdfPermissionsBits,
    allAllowed: row.security.pdfPermissionsAllAllowed,
    openedAs: row.security.pdfOpenedAs,
    securityHandlerRevision: row.security.securityHandlerRevision,
    canUpgradeToOwner:
      row.security.encryptionState === 'encrypted' && row.security.pdfOpenedAs !== 'owner',
  };
  const reasons: DocumentHead['access']['reasons'] = [];
  if (row.security.encryptionRequiresPassword === true && !permissions.known) {
    reasons.push('password');
  }
  if (row.security.encryptionState === 'unknown') reasons.push('permissions-unknown');

  return {
    id: row.id,
    baseSha,
    storageSizeBytes: row.storageSizeBytes ?? 0,
    docVersion: row.docVersion,
    state: row.state,
    encryption: {
      state: row.security.encryptionState,
      requiresPassword: row.security.encryptionRequiresPassword,
    },
    permissions,
    access: {
      required: reasons.length > 0,
      reasons,
      ...(reasons.length > 0 ? { endpoint: '/v1/access' } : {}),
    },
  };
}

function requireBaseSha(row: DocumentRow): string {
  if (!row.baseSha) {
    throw new EngineError(
      EngineErrorCode.DocOpenFailed,
      `document is ready but has no base_sha: ${row.id}`,
    );
  }
  return row.baseSha;
}

function securityFingerprint(row: DocumentRow): string {
  return [
    row.security.encryptionState,
    row.security.encryptionRequiresPassword === null
      ? 'unknown'
      : row.security.encryptionRequiresPassword
        ? 'password'
        : 'open',
    row.security.securityHandlerRevision ?? 'none',
  ].join(':');
}

function securityInfoFromCachedVerification(row: {
  openedAs: 'none' | 'user' | 'owner';
  pdfPermissionsBits: number;
  pdfPermissionsAllAllowed: boolean;
  securityHandlerRevision: number | null;
}): DocumentSecurityProbeInfo {
  return {
    encryptionState: row.openedAs === 'none' ? 'none' : 'encrypted',
    encryptionRequiresPassword: false,
    securityHandlerRevision: row.securityHandlerRevision,
    pdfPermissionsBits: row.pdfPermissionsBits,
    pdfPermissionsAllAllowed: row.pdfPermissionsAllAllowed,
    pdfOpenedAs: row.openedAs,
    securityProbedAt: Date.now(),
  };
}

function safeFilePart(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'document';
}
