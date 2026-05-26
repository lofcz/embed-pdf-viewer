import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import compress from '@fastify/compress';
import type { Kysely } from 'kysely';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core/runtime';
import { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import { BaseFileCache } from '../storage/BaseFileCache';
import type { ObjectStoreWithInfo } from '../storage/ObjectStore';
import type { Database as Schema } from '../db/schema';
import { DocumentsRepo } from '../db/repos/documents.repo';
import { TenantsRepo } from '../db/repos/tenants.repo';
import { DocumentPagesRepo, LayerPagesRepo, LayersRepo } from '../db/repos/page_state.repo';
import { WeakAnnotationSessionsRepo } from '../db/repos/weak_annotation_sessions.repo';
import { DocumentLifecycleService } from '../services/DocumentLifecycleService';
import { DocumentService } from '../services/DocumentService';
import { DocumentSecurityProbe } from '../services/DocumentSecurityProbe';
import { CloudRevisionBridge } from '../services/CloudRevisionBridge';
import { EventLogService } from '../services/EventLogService';
import { LayerStateService } from '../services/LayerStateService';
import { LayerService } from '../services/LayerService';
import { WeakAnnotationSessionService } from '../services/WeakAnnotationSessionService';
import { validate as validateMigrations, type MigrationSource } from '../db/migrator/runner';
import { RevokedJtisGuard } from '../auth/RevokedJtisGuard';
import { DbJwksCacheStore } from '../auth/JwksCacheStore';
import type { JwtVerifierConfig, RevocationCheck, JwksCacheStore } from '../auth/JwtVerifier';
import { registerJwtAuth } from './jwt-plugin';
import { registerDocsRoutes } from '../routes/docs';
import { registerAnnotationRoutes } from '../routes/annotations';
import { registerMetadataRoutes } from '../routes/metadata';
import { registerPageRoutes } from '../routes/pages';
import { registerAdminDocumentsRoutes } from '../routes/admin/documents';
import { registerAdminTokensRoutes } from '../routes/admin/tokens';
import { SharpImageEncoder } from '../render/SharpImageEncoder';
import type { KmsKeyring } from '../security';

export interface BuildAppOptions {
  /**
   * JWT verifier config. Use `{ mode: 'hs256', secret }` for Tiny/dev
   * deployments, or RS/ES/JWKS modes for production IdP integration.
   */
  verifier: JwtVerifierConfig;
  /**
   * If true and `db` is supplied, wire a `RevokedJtisGuard` into the
   * verifier so revoked `jti`s are rejected at request time. Off by
   * default to keep dev tests cheap.
   */
  enableRevocation?: boolean;
  /**
   * If true and `db` + `verifier.mode === 'jwks'`, plug the
   * persistent `jwks_cache` table into the JWKS verifier so the
   * cache survives restarts.
   */
  enableJwksPersistence?: boolean;
  poolSize?: number;
  /**
   * URL of the worker_thread entry script. The package's main entry exports
   * `defaultWorkerEntryUrl` which works in both dev (tsx -> src/) and after
   * a Vite build (ESM dist/). Pass that unless you have a custom worker.
   */
  /**
   * Set to `null` (or omit) to skip worker_thread initialisation. Use
   * this for admin-only deployments where no engine reads happen
   * through this Fastify process. The admin routes don't depend on
   * the pool.
   */
  workerEntry: URL | string | null;
  /** Override Fastify body limit. Defaults to 50 MiB. */
  bodyLimit?: number;
  /**
   * Optional Kysely DB handle. When supplied together with `objectStore`,
   * the admin routes under `/v1/admin/*` are registered. Engine-only
   * deployments can omit both.
   */
  db?: Kysely<Schema>;
  objectStore?: ObjectStoreWithInfo;
  /**
   * Optional envelope keyring for features that need short-lived
   * encrypted server state (for example encrypted PDF password
   * sessions in the CDN phase). Presently stored on the app bundle
   * so future services can consume it without changing boot wiring.
   */
  kms?: KmsKeyring;
  /**
   * If true and an admin call arrives for a tenant that doesn't have a
   * `tenants` row, lazily create one. Convenient for dev / single-tenant
   * deploys; production deployments should leave this off and provision
   * explicitly.
   */
  autoProvisionTenant?: boolean;
  /**
   * Interval for the background sweeper that GCs `pending` rows older
   * than `pendingTtlMs`. Set to 0 to disable. Defaults to 60_000 ms.
   */
  sweepIntervalMs?: number;
  /** Max age of a `pending` doc before it's considered abandoned. */
  pendingTtlMs?: number;
  /**
   * Phase 3 — when supplied (with `db`, `objectStore`, and a worker
   * pool), enables the cloud `/v1/docs/...` routes via the
   * `DocumentService` orchestrator. The required pieces are:
   *
   *   - `cacheRoot`        absolute path the BaseFileCache uses
   *   - `cacheMaxBytes`    disk budget (default 4 GiB)
   *   - `maxDocsPerSlot`   worker pool slot capacity (default 64)
   *
   * Disable by leaving `cacheRoot` unset.
   */
  cacheRoot?: string;
  cacheMaxBytes?: number;
  maxDocsPerSlot?: number;
  /**
   * Migration set this build expects to be applied. When supplied
   * (alongside `db`), buildApp runs `validate()` at boot and refuses
   * to start if the DB has drift (checksum mismatch on an applied
   * migration, or a migration applied in DB but missing in code).
   *
   * Set `failOnPending: true` to also refuse to start when pending
   * migrations exist — recommended for production where operators
   * run `migrate up` explicitly before rolling out new pods.
   */
  expectedMigrations?: ReadonlyArray<MigrationSource>;
  /** Treat pending migrations as drift at boot. Defaults to false. */
  failOnPending?: boolean;
}

export interface AppBundle {
  app: FastifyInstance;
  /** Present only when `workerEntry` was supplied. */
  pool?: WorkerThreadPool;
  /** Present only when `db` + `objectStore` were configured. */
  lifecycle?: DocumentLifecycleService;
  /** Present only when `enableRevocation: true` with a `db`. */
  revokedJtisGuard?: RevokedJtisGuard;
  /** Phase 3 — present only when `cacheRoot` is set (+ pool + db). */
  documentService?: DocumentService;
  /** Phase 5 — write-side lazy layer materialization service. */
  layerService?: LayerService;
  /** Phase 3 — the base-file cache backing `documentService`. */
  baseFileCache?: BaseFileCache;
  /** Security substrate keyring, when configured by the caller. */
  kms?: KmsKeyring;
  shutdown: () => Promise<void>;
}

/**
 * Build the Fastify app with JWT auth, admin routes, and the cloud
 * document routes when their adapters are configured. Caller is
 * responsible for `app.listen()`.
 */
export async function buildApp(opts: BuildAppOptions): Promise<AppBundle> {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
    bodyLimit: opts.bodyLimit ?? 50 * 1024 * 1024,
    // Use Fastify's default (`fast-querystring`) which yields a FLAT
    // Record<string, string> — `?viewport.kind=width` parses as
    // `{ "viewport.kind": "width" }`, not `{ viewport: { kind: "width" } }`.
    // The render wire format depends on this: dotted keys are reassembled
    // into nested objects by `unflatten()` in the route handler. DO NOT
    // switch to `qs` or another nesting parser — it would silently pre-nest
    // these keys and break the wire-roundtrip property.
    //
    // Bump the router's default `maxParamLength` (find-my-way's hard cap is
    // 100 chars by default) so render tokens like
    // `render@annotationVersion=N,background=X,contentVersion=N,format=webp,…`
    // can exceed that ceiling without 404-ing at the router. The token
    // codec separately enforces a 512-char limit, so this stays bounded.
    maxParamLength: 512,
  });

  await app.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ['br', 'gzip', 'deflate'],
  });

  await app.register(multipart, {
    limits: { fileSize: opts.bodyLimit ?? 50 * 1024 * 1024 },
  });

  // Raw upload bodies for /v1/admin/.../upload-direct. Fastify only
  // pre-parses application/json by default; binary uploads need this
  // explicit parser. We keep it scoped to PDF mime types so a stray
  // JSON request still gets the JSON-parsing error path.
  app.addContentTypeParser(
    'application/pdf',
    { parseAs: 'buffer', bodyLimit: opts.bodyLimit ?? 50 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: opts.bodyLimit ?? 50 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  // Optional revocation + JWKS persistence guards. Both are no-ops
  // unless explicitly enabled — admin-only tests / dev runs don't
  // need them and they require a DB.
  let revokedJtisGuard: RevokedJtisGuard | undefined;
  let revocation: RevocationCheck | undefined;
  if (opts.enableRevocation && opts.db) {
    revokedJtisGuard = new RevokedJtisGuard({ db: opts.db });
    revocation = revokedJtisGuard;
  }
  let jwksCacheStore: JwksCacheStore | undefined;
  if (opts.enableJwksPersistence && opts.db) {
    jwksCacheStore = new DbJwksCacheStore(opts.db);
  }

  // Inject the revocation + cache store into whichever mode the
  // caller picked. We don't overwrite if they're already set.
  const verifierConfig = {
    ...opts.verifier,
    revocation: opts.verifier.revocation ?? revocation,
    ...(opts.verifier.mode === 'jwks' && !opts.verifier.cacheStore
      ? { cacheStore: jwksCacheStore }
      : {}),
  } as JwtVerifierConfig;
  await registerJwtAuth(app, { verifier: verifierConfig });

  // `documentService` is allocated below, but the pool's onEvict
  // hook needs to reference it. Use a forward-binding closure:
  // `evictForward` defers to whatever lives in `documentService` at
  // call time. Without this, we'd need to construct the pool twice
  // or expose a mutable setter on the service — both worse.
  let documentService: DocumentService | undefined;
  const evictForward = (evt: { docId: string; baseSha: string; slot: number }): void => {
    documentService?.onPoolEvict(evt);
  };

  const pool: WorkerThreadPool | undefined = opts.workerEntry
    ? await WorkerThreadPool.create({
        size: opts.poolSize,
        workerEntry: opts.workerEntry,
        maxDocsPerSlot: opts.maxDocsPerSlot,
        onEvict: evictForward,
      })
    : undefined;
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => ({ status: 'ok' }));

  // Drift detection at boot. Production deployments should supply
  // `expectedMigrations` — if the DB has a checksum mismatch or an
  // applied migration vanished from code, we refuse to serve traffic
  // rather than silently running on an unexpected schema. This is the
  // safety net for "someone edited a migration and force-rolled it".
  if (opts.db && opts.expectedMigrations && opts.expectedMigrations.length > 0) {
    const issues = await validateMigrations(opts.db, opts.expectedMigrations, {
      treatPendingAsDrift: opts.failOnPending ?? false,
    });
    if (issues.length > 0) {
      const lines = issues.map((i) => `  - [${i.kind}] ${i.message}`).join('\n');
      throw new Error(`buildApp: migration drift detected, refusing to start:\n${lines}`);
    }
  }

  let lifecycle: DocumentLifecycleService | undefined;
  let layerService: LayerService | undefined;
  let sweeperTimer: NodeJS.Timeout | undefined;
  let baseFileCache: BaseFileCache | undefined;
  if (opts.db && opts.objectStore) {
    if (opts.cacheRoot && pool) {
      baseFileCache = new BaseFileCache({
        root: opts.cacheRoot,
        maxBytes: opts.cacheMaxBytes ?? 4 * 1024 * 1024 * 1024,
        store: opts.objectStore,
      });
      // One-shot boot sweep: a crash during a prior materialise can
      // leave `.partial.*` files behind. Better to clean them up
      // here than to surface bogus disk-usage stats to ops.
      await baseFileCache.sweepPartials();
    }

    lifecycle = new DocumentLifecycleService({
      documents: new DocumentsRepo(opts.db),
      tenants: new TenantsRepo(opts.db),
      storage: opts.objectStore,
      autoProvisionTenant: opts.autoProvisionTenant ?? false,
      securityProbe: new DocumentSecurityProbe({ cache: baseFileCache, pool }),
    });
    await registerAdminDocumentsRoutes(app, { lifecycle });
    if (revokedJtisGuard) {
      await registerAdminTokensRoutes(app, { guard: revokedJtisGuard });
    }

    // Phase 3: wire the doc-scoped routes when the operator has
    // chosen a cache root. Requires the worker pool — admin-only
    // deploys (no `workerEntry`) keep the legacy admin surface and
    // skip the cloud open surface entirely.
    if (baseFileCache && pool) {
      const layerStateService = new LayerStateService({
        documentPages: new DocumentPagesRepo(opts.db),
        layers: new LayersRepo(opts.db),
        layerPages: new LayerPagesRepo(opts.db),
      });
      const cloudRevisionBridge = new CloudRevisionBridge();
      const weakAnnotationSessions = new WeakAnnotationSessionService({
        repo: new WeakAnnotationSessionsRepo(opts.db),
      });
      const eventLog = new EventLogService({ storage: opts.objectStore });
      documentService = new DocumentService({
        documents: new DocumentsRepo(opts.db),
        cache: baseFileCache,
        storage: opts.objectStore,
        pool,
        layerState: layerStateService,
      });
      layerService = new LayerService({
        db: opts.db,
        documents: new DocumentsRepo(opts.db),
        layerState: layerStateService,
        revisionBridge: cloudRevisionBridge,
        eventLog,
        weakAnnotationSessions,
        documentService,
        pool,
        storage: opts.objectStore,
      });
      await registerDocsRoutes(app, { service: documentService });
      await registerMetadataRoutes(app, { service: documentService });
      await registerPageRoutes(app, {
        documentService,
        layerService,
        pool,
        imageEncoder: new SharpImageEncoder(),
      });
      await registerAnnotationRoutes(app, {
        documentService,
        layerService,
        pool,
        revisionBridge: cloudRevisionBridge,
        weakAnnotationSessions,
      });
    }

    const sweepIntervalMs = opts.sweepIntervalMs ?? 60_000;
    const pendingTtlMs = opts.pendingTtlMs ?? 60 * 60 * 1000; // 1h default
    if (sweepIntervalMs > 0) {
      sweeperTimer = setInterval(() => {
        lifecycle!
          .sweepStalePending({ olderThanMs: pendingTtlMs })
          .catch((err) => app.log.error({ err }, 'sweepStalePending failed'));
      }, sweepIntervalMs);
      sweeperTimer.unref();
    }
  }

  app.setErrorHandler((err, req, reply) => {
    if (EngineError.is(err)) {
      const code = mapToHttp(err.code);
      // The `name: 'EngineError'` discriminator is required by
      // EngineErrorPayloadSchema on the client side; without it the
      // typed code/message/details get dropped and clients see a
      // status-only InvalidArg fallback.
      reply.code(code).send({
        error: {
          name: 'EngineError',
          code: err.code,
          message: err.message,
          details: err.details,
        },
      });
      return;
    }
    const e = err as Error & { code?: string; status?: number };
    if (e.status && typeof e.status === 'number') {
      reply.code(e.status).send({ error: { code: e.code ?? 'Unknown', message: e.message } });
      return;
    }
    if (e.code === 'NotFound') {
      reply.code(404).send({ error: { code: 'NotFound', message: e.message } });
      return;
    }
    if (e.code === 'Forbidden') {
      reply.code(403).send({ error: { code: 'Forbidden', message: e.message } });
      return;
    }
    req.log.error({ err: e }, 'unhandled error');
    reply.code(500).send({ error: { code: 'Unknown', message: e.message } });
  });

  const shutdown = async () => {
    if (sweeperTimer) clearInterval(sweeperTimer);
    try {
      await app.close();
    } finally {
      try {
        if (pool) await pool.destroy();
      } finally {
        documentService?.releaseAllBaseHandles();
        if (baseFileCache) await baseFileCache.destroy();
      }
    }
  };

  return {
    app,
    pool,
    lifecycle,
    revokedJtisGuard,
    documentService,
    layerService,
    baseFileCache,
    kms: opts.kms,
    shutdown,
  };
}

function mapToHttp(code: string): number {
  switch (code) {
    case EngineErrorCode.InvalidArg:
    case EngineErrorCode.WireFormat:
    case EngineErrorCode.InvalidReference:
      return 400;
    case EngineErrorCode.Unauthenticated:
      return 401;
    case EngineErrorCode.Forbidden:
      return 403;
    case EngineErrorCode.WeakAnnotationSessionConflict:
      return 409;
    case EngineErrorCode.NotFound:
    case EngineErrorCode.DocNotOpen:
      return 404;
    case EngineErrorCode.DocOpenFailed:
    case EngineErrorCode.DocPasswordRequired:
    case EngineErrorCode.DocPasswordIncorrect:
    case EngineErrorCode.MalformedPdf:
      return 422;
    case EngineErrorCode.Aborted:
      return 499;
    case EngineErrorCode.NotImplemented:
      return 501;
    default:
      return 500;
  }
}
