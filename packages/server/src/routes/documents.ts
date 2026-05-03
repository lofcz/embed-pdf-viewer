import type { FastifyInstance } from 'fastify';
import { wirePaths } from '@embedpdf/engine-core';
import type { WorkerJobId } from '@embedpdf/engine-core';
import type { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import type { InMemoryDocumentStore } from '../storage/InMemoryDocumentStore';
import { requireTenant } from '../app/jwt-plugin';

export interface DocumentsRouteDeps {
  pool: WorkerThreadPool;
  store: InMemoryDocumentStore;
}

export async function registerDocumentRoutes(
  app: FastifyInstance,
  deps: DocumentsRouteDeps,
): Promise<void> {
  const { pool, store } = deps;

  app.post(wirePaths.documents, async (req, reply) => {
    const tenantId = requireTenant(req);
    const data = await req.file();
    if (!data) {
      reply.code(400);
      return { error: 'expected multipart upload with file field' };
    }
    const buf = await data.toBuffer();
    const password = (data.fields['password'] as { value?: string } | undefined)?.value ?? null;
    const idField = (data.fields['id'] as { value?: string } | undefined)?.value;
    const docId =
      idField || `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const result = await pool.open(docId, new Uint8Array(buf), password);
    if (result.tag !== 'open') {
      reply.code(500);
      return { error: 'unexpected response from worker' };
    }
    store.put({ docId: result.docId, tenantId, createdAt: Date.now() });
    return { id: result.docId };
  });

  app.delete(`${wirePaths.documents}/:id`, async (req, reply) => {
    const tenantId = requireTenant(req);
    const { id } = req.params as { id: string };
    store.requireOwned(id, tenantId);
    await pool.close(id);
    store.remove(id);
    reply.code(204);
    return null;
  });

  // Helper kept here so the metadata route can reuse the same dispatcher.
  void ((build: (jobId: WorkerJobId) => unknown) => build);
}
