import type { FastifyInstance } from 'fastify';
import {
  EngineError,
  EngineErrorCode,
  wirePaths,
  type WorkerJobId,
  type WorkerRequest,
} from '@embedpdf/engine-core';
import type { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import type { InMemoryDocumentStore } from '../storage/InMemoryDocumentStore';
import { requireTenant } from '../app/jwt-plugin';

export interface AnnotationRouteDeps {
  pool: WorkerThreadPool;
  store: InMemoryDocumentStore;
}

/**
 * Annotation routes for the v3 alpha slice. Reads are wired:
 *   GET  /v1/documents/:id/annotations                                   - listRawAll
 *   GET  /v1/documents/:id/pages/:pon/annotations/raw                    - listRaw
 *   GET  /v1/documents/:id/pages/:pon/annotations                        - listFull
 *
 * Mutation routes are typed but return 501 NotImplemented; clients can
 * detect and degrade. They lock the wire shape so subsequent slices can
 * implement them without breaking changes.
 */
export async function registerAnnotationRoutes(
  app: FastifyInstance,
  deps: AnnotationRouteDeps,
): Promise<void> {
  const { pool, store } = deps;

  app.get(`${wirePaths.documents}/:id/annotations`, async (req, _reply) => {
    const tenantId = requireTenant(req);
    const { id } = req.params as { id: string };
    store.requireOwned(id, tenantId);
    const signal = abortSignalFromRequest(req);

    const build = (jobId: WorkerJobId): WorkerRequest => ({
      kind: 'annotations.listRawAll',
      jobId,
      docId: id,
    });
    const result = await pool.run(id, build, signal);
    if (result.tag !== 'annotations.listRawAll') {
      throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload: ${result.tag}`);
    }
    return result.snapshot;
  });

  app.get(`${wirePaths.documents}/:id/pages/:pon/annotations/raw`, async (req, _reply) => {
    const tenantId = requireTenant(req);
    const { id, pon } = req.params as { id: string; pon: string };
    const pageObjectNumber = parsePageObjectNumber(pon);
    store.requireOwned(id, tenantId);
    const signal = abortSignalFromRequest(req);

    const build = (jobId: WorkerJobId): WorkerRequest => ({
      kind: 'annotations.listRawPage',
      jobId,
      docId: id,
      pageObjectNumber,
    });
    const result = await pool.run(id, build, signal);
    if (result.tag !== 'annotations.listRawPage') {
      throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload: ${result.tag}`);
    }
    return result.snapshot;
  });

  app.get(`${wirePaths.documents}/:id/pages/:pon/annotations`, async (req, _reply) => {
    const tenantId = requireTenant(req);
    const { id, pon } = req.params as { id: string; pon: string };
    const pageObjectNumber = parsePageObjectNumber(pon);
    store.requireOwned(id, tenantId);
    const signal = abortSignalFromRequest(req);

    const build = (jobId: WorkerJobId): WorkerRequest => ({
      kind: 'annotations.listFullPage',
      jobId,
      docId: id,
      pageObjectNumber,
    });
    const result = await pool.run(id, build, signal);
    if (result.tag !== 'annotations.listFullPage') {
      throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload: ${result.tag}`);
    }
    return result.snapshot;
  });

  // Mutation surface: return 501 with EngineError(NotImplemented). The
  // global error handler maps NotImplemented -> 501.
  const notImplemented = () => {
    throw new EngineError(
      EngineErrorCode.NotImplemented,
      'annotation mutations are not implemented in this engine slice',
    );
  };
  app.post(`${wirePaths.documents}/:id/pages/:pon/annotations`, async (req) => {
    requireTenant(req);
    notImplemented();
  });
  app.patch(`${wirePaths.documents}/:id/pages/:pon/annotations/:annotKey`, async (req) => {
    requireTenant(req);
    notImplemented();
  });
  app.delete(`${wirePaths.documents}/:id/pages/:pon/annotations/:annotKey`, async (req) => {
    requireTenant(req);
    notImplemented();
  });
}

function parsePageObjectNumber(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new EngineError(
      EngineErrorCode.InvalidArg,
      `pageObjectNumber must be a positive integer, got '${raw}'`,
    );
  }
  return n;
}

function abortSignalFromRequest(req: {
  raw: { on(event: 'close', cb: () => void): void };
}): AbortSignal {
  const ctrl = new AbortController();
  req.raw.on('close', () => ctrl.abort());
  return ctrl.signal;
}
