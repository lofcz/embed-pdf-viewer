import type { FastifyInstance } from 'fastify';
import {
  EngineErrorCode,
  EngineError,
  wirePaths,
  type WorkerJobId,
  type WorkerRequest,
} from '@embedpdf/engine-core';
import type { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import type { InMemoryDocumentStore } from '../storage/InMemoryDocumentStore';
import { requireTenant } from '../app/jwt-plugin';

export interface MetadataRouteDeps {
  pool: WorkerThreadPool;
  store: InMemoryDocumentStore;
}

export async function registerMetadataRoutes(
  app: FastifyInstance,
  deps: MetadataRouteDeps,
): Promise<void> {
  const { pool, store } = deps;

  app.get(`${wirePaths.documents}/:id/metadata`, async (req, reply) => {
    const tenantId = requireTenant(req);
    const { id } = req.params as { id: string };
    store.requireOwned(id, tenantId);

    // Fastify's request gets an AbortSignal from req.raw on disconnect; we
    // forward it so the worker can short-circuit if the client gives up.
    const signal = abortSignalFromRequest(req);

    const build = (jobId: WorkerJobId): WorkerRequest => ({
      kind: 'metadata.read',
      jobId,
      docId: id,
    });
    const result = await pool.run(id, build, signal);
    if (result.tag !== 'metadata.read') {
      reply.code(500);
      throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload: ${result.tag}`);
    }
    return result.metadata;
  });
}

function abortSignalFromRequest(req: {
  raw: { on(event: 'close', cb: () => void): void };
}): AbortSignal {
  const ctrl = new AbortController();
  req.raw.on('close', () => ctrl.abort());
  return ctrl.signal;
}
