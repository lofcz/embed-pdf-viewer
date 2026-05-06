import type { FastifyInstance } from 'fastify';
import {
  EngineError,
  EngineErrorCode,
  PageMoveInputSchema,
  wirePaths,
  type PageMoveInput,
  type WorkerJobId,
  type WorkerRequest,
} from '@embedpdf/engine-core';
import type { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import type { InMemoryDocumentStore } from '../storage/InMemoryDocumentStore';
import { requireTenant } from '../app/jwt-plugin';
import { abortSignalFromRequest, parseOrInvalidArg, type SchemaLike } from './_helpers';

export interface PagesRouteDeps {
  pool: WorkerThreadPool;
  store: InMemoryDocumentStore;
}

/**
 * Page-level routes for v3.
 *
 *   GET  /v1/documents/:id/pages         -> PageListSnapshot
 *   POST /v1/documents/:id/pages/move    body=PageMoveInput  -> PageMoveResult
 *
 * The `/pages/move` path is registered before any `/pages/:pon/...`
 * subroutes by virtue of Fastify's find-my-way preferring static
 * segments over parameter segments at the same depth. (Belt-and-braces
 * note for future maintainers: do not introduce a `:pon` style route
 * that overlaps `move` without re-checking precedence.)
 *
 * Page identity rule (locked with the user, do not loosen): pages are
 * always addressed by `pageObjectNumber`. The wire never accepts a
 * "page index" for mutations. This is what lets clients queue multiple
 * reorder requests without index-drift hazards.
 */
export async function registerPagesRoutes(
  app: FastifyInstance,
  deps: PagesRouteDeps,
): Promise<void> {
  const { pool, store } = deps;

  app.get(`${wirePaths.documents}/:id/pages`, async (req, _reply) => {
    const tenantId = requireTenant(req);
    const { id } = req.params as { id: string };
    store.requireOwned(id, tenantId);
    const signal = abortSignalFromRequest(req);

    const build = (jobId: WorkerJobId): WorkerRequest => ({
      kind: 'pages.list',
      jobId,
      docId: id,
    });
    const result = await pool.run(id, build, signal);
    if (result.tag !== 'pages.list') {
      throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload: ${result.tag}`);
    }
    return result.snapshot;
  });

  app.post(`${wirePaths.documents}/:id/pages/move`, async (req, _reply) => {
    const tenantId = requireTenant(req);
    const { id } = req.params as { id: string };
    store.requireOwned(id, tenantId);
    const signal = abortSignalFromRequest(req);

    const input = parseOrInvalidArg<PageMoveInput>(
      PageMoveInputSchema as unknown as SchemaLike<PageMoveInput>,
      req.body,
      'request body',
    );
    const build = (jobId: WorkerJobId): WorkerRequest => ({
      kind: 'pages.move',
      jobId,
      docId: id,
      pageObjectNumbers: input.pageObjectNumbers,
      destIndex: input.destIndex,
    });
    const result = await pool.run(id, build, signal);
    if (result.tag !== 'pages.move') {
      throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload: ${result.tag}`);
    }
    return result.result;
  });
}
