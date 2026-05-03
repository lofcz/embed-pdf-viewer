import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core';
import { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import { InMemoryDocumentStore } from '../storage/InMemoryDocumentStore';
import { registerJwtAuth } from './jwt-plugin';
import { registerDocumentRoutes } from '../routes/documents';
import { registerMetadataRoutes } from '../routes/metadata';
import { registerAnnotationRoutes } from '../routes/annotations';

export interface BuildAppOptions {
  jwtSecret: string;
  poolSize?: number;
  /**
   * URL of the worker_thread entry script. The package's main entry exports
   * `defaultWorkerEntryUrl` which works in both dev (tsx -> src/) and after
   * a Vite build (ESM dist/). Pass that unless you have a custom worker.
   */
  workerEntry: URL | string;
  /** Override Fastify body limit. Defaults to 50 MiB. */
  bodyLimit?: number;
}

export interface AppBundle {
  app: FastifyInstance;
  pool: WorkerThreadPool;
  store: InMemoryDocumentStore;
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

  await registerJwtAuth(app, { secret: opts.jwtSecret });

  const pool = await WorkerThreadPool.create({
    size: opts.poolSize,
    workerEntry: opts.workerEntry,
  });
  const store = new InMemoryDocumentStore();

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => ({ status: 'ok' }));

  await registerDocumentRoutes(app, { pool, store });
  await registerMetadataRoutes(app, { pool, store });
  await registerAnnotationRoutes(app, { pool, store });

  app.setErrorHandler((err, req, reply) => {
    if (EngineError.is(err)) {
      const code = mapToHttp(err.code);
      reply
        .code(code)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    const e = err as Error & { code?: string };
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
    try {
      await app.close();
    } finally {
      await pool.destroy();
    }
  };

  return { app, pool, store, shutdown };
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
      return 422;
    case EngineErrorCode.Aborted:
      return 499;
    case EngineErrorCode.NotImplemented:
      return 501;
    default:
      return 500;
  }
}
