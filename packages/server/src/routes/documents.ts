import type { FastifyInstance } from 'fastify';
import { wirePaths, wirePack } from '@embedpdf/engine-core';
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

    // Slice off a freestanding ArrayBuffer that owns just our PDF bytes.
    // The slice gives us a buffer we can declare as transferable without
    // worrying about Fastify/multipart still holding a view on the
    // underlying pool memory; once we hand it to `wirePack(..., [buffer])`
    // and then to the worker, that buffer is detached on the server side.
    const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

    // The route is the only layer that holds the original Buffer, so it's
    // the right place to declare the transfer. `wirePack(req, [buffer])`
    // is the producer-local statement: "this message moves this buffer".
    const build = (jobId: WorkerJobId) =>
      wirePack({ kind: 'open' as const, jobId, docId, bytes: buffer, password }, [buffer]);

    const result = await pool.runOpen(docId, build);
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
