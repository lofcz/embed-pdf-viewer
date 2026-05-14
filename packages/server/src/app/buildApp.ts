import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import type { Kysely } from 'kysely';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core/runtime';
import { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import { InMemoryDocumentStore } from '../storage/InMemoryDocumentStore';
import type { ObjectStoreWithInfo } from '../storage/ObjectStore';
import type { Database as Schema } from '../db/schema';
import { DocumentsRepo } from '../db/repos/documents.repo';
import { TenantsRepo } from '../db/repos/tenants.repo';
import { DocumentLifecycleService } from '../services/DocumentLifecycleService';
import { registerJwtAuth } from './jwt-plugin';
import { registerDocumentRoutes } from '../routes/documents';
import { registerMetadataRoutes } from '../routes/metadata';
import { registerAnnotationRoutes } from '../routes/annotations';
import { registerPagesRoutes } from '../routes/pages';
import { registerAdminDocumentsRoutes } from '../routes/admin/documents';

export interface BuildAppOptions {
  jwtSecret: string;
  poolSize?: number;
  /**
   * URL of the worker_thread entry script. The package's main entry exports
   * `defaultWorkerEntryUrl` which works in both dev (tsx -> src/) and after
   * a Vite build (ESM dist/). Pass that unless you have a custom worker.
   */
  /**
   * Set to `null` (or omit) to skip worker_thread initialisation. Use
   * this for admin-only deployments where no engine reads happen
   * through this Fastify process. The engine routes (`/v1/documents`,
   * `/v1/.../pages/...`) are still registered but will throw 503 at
   * call time. The admin routes don't depend on the pool.
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
}

export interface AppBundle {
  app: FastifyInstance;
  /** Present only when `workerEntry` was supplied. */
  pool?: WorkerThreadPool;
  store: InMemoryDocumentStore;
  /** Present only when `db` + `objectStore` were configured. */
  lifecycle?: DocumentLifecycleService;
  shutdown: () => Promise<void>;
}

/**
 * Build the Fastify app with the worker pool, in-memory store, JWT auth,
 * and the alpha-slice routes. Caller is responsible for `app.listen()`.
 */
export async function buildApp(opts: BuildAppOptions): Promise<AppBundle> {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
    bodyLimit: opts.bodyLimit ?? 50 * 1024 * 1024,
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

  await registerJwtAuth(app, { secret: opts.jwtSecret });

  const pool: WorkerThreadPool | undefined = opts.workerEntry
    ? await WorkerThreadPool.create({
        size: opts.poolSize,
        workerEntry: opts.workerEntry,
      })
    : undefined;
  const store = new InMemoryDocumentStore();

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => ({ status: 'ok' }));

  if (pool) {
    await registerDocumentRoutes(app, { pool, store });
    await registerMetadataRoutes(app, { pool, store });
    await registerPagesRoutes(app, { pool, store });
    await registerAnnotationRoutes(app, { pool, store });
  }

  let lifecycle: DocumentLifecycleService | undefined;
  let sweeperTimer: NodeJS.Timeout | undefined;
  if (opts.db && opts.objectStore) {
    lifecycle = new DocumentLifecycleService({
      documents: new DocumentsRepo(opts.db),
      tenants: new TenantsRepo(opts.db),
      storage: opts.objectStore,
      autoProvisionTenant: opts.autoProvisionTenant ?? false,
    });
    await registerAdminDocumentsRoutes(app, { lifecycle });

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
      if (pool) await pool.destroy();
    }
  };

  return { app, pool, store, lifecycle, shutdown };
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
