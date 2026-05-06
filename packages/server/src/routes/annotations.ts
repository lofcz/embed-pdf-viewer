import type { FastifyInstance } from 'fastify';
import {
  AnnotationDraftSchema,
  AnnotationPatchSchema,
  AnnotationRefSchema,
  EngineError,
  EngineErrorCode,
  decodeStableIdKey,
  wirePaths,
  type AnnotationDraft,
  type AnnotationPatch,
  type AnnotationRef,
  type WorkerJobId,
  type WorkerRequest,
} from '@embedpdf/engine-core';
import type { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import type { InMemoryDocumentStore } from '../storage/InMemoryDocumentStore';
import { requireTenant } from '../app/jwt-plugin';
import { abortSignalFromRequest, parseOrInvalidArg, type SchemaLike } from './_helpers';

export interface AnnotationRouteDeps {
  pool: WorkerThreadPool;
  store: InMemoryDocumentStore;
}

/**
 * Annotation routes for the v3 mutations slice. Read paths (GET) are
 * unchanged from the previous slice; create/update/delete are now wired
 * to the worker pool and emit the same `AnnotationCreateResult` /
 * `AnnotationUpdateResult` / `AnnotationDeleteResult` shapes the local
 * engine produces.
 *
 * Identity routing:
 *   POST   /v1/documents/:id/pages/:pon/annotations                  body=AnnotationDraft
 *   PATCH  /v1/documents/:id/pages/:pon/annotations/:annotKey        body={ patch }                 (annotKey = obj:N | nm:VAL)
 *   PATCH  /v1/documents/:id/pages/:pon/annotations/index            body={ ref, patch }            (kind: 'index' update)
 *   PATCH  /v1/documents/:id/pages/:pon/annotations/index            body={ ref, op: 'delete' }     (kind: 'index' delete)
 *   DELETE /v1/documents/:id/pages/:pon/annotations/:annotKey                                       (annotKey = obj:N | nm:VAL)
 *
 * The `index` PATCH variant exists because index refs cannot be encoded
 * as a URL-safe stable id; they need a fresh `RevisionToken` to validate
 * liveness, which travels in the body.
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

  app.post(`${wirePaths.documents}/:id/pages/:pon/annotations`, async (req, _reply) => {
    const tenantId = requireTenant(req);
    const { id, pon } = req.params as { id: string; pon: string };
    const pageObjectNumber = parsePageObjectNumber(pon);
    store.requireOwned(id, tenantId);
    const signal = abortSignalFromRequest(req);

    const draft = parseOrInvalidArg<AnnotationDraft>(
      AnnotationDraftSchema as unknown as SchemaLike<AnnotationDraft>,
      req.body,
      'request body',
    );
    const build = (jobId: WorkerJobId): WorkerRequest => ({
      kind: 'annotations.create',
      jobId,
      docId: id,
      pageObjectNumber,
      draft,
    });
    const result = await pool.run(id, build, signal);
    if (result.tag !== 'annotations.create') {
      throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload: ${result.tag}`);
    }
    return result.result;
  });

  // POST /annotations/move: batch reorder. Registered as a static
  // segment so Fastify resolves it before `:annotKey` (which only
  // applies to PATCH/DELETE anyway, but kept explicit for clarity).
  app.post(`${wirePaths.documents}/:id/pages/:pon/annotations/move`, async (req, _reply) => {
    const tenantId = requireTenant(req);
    const { id, pon } = req.params as { id: string; pon: string };
    const pageObjectNumber = parsePageObjectNumber(pon);
    store.requireOwned(id, tenantId);
    const signal = abortSignalFromRequest(req);

    const body = req.body as Record<string, unknown> | null | undefined;
    const rawRefs = body?.refs;
    const rawToIndex = body?.toIndex;
    if (!Array.isArray(rawRefs)) {
      throw new EngineError(
        EngineErrorCode.InvalidArg,
        `body.refs: expected non-empty array of AnnotationRef`,
      );
    }
    if (typeof rawToIndex !== 'number' || !Number.isInteger(rawToIndex)) {
      throw new EngineError(
        EngineErrorCode.InvalidArg,
        `body.toIndex: expected non-negative integer`,
      );
    }
    const refs: AnnotationRef[] = rawRefs.map((raw, i) => {
      const r = parseOrInvalidArg<AnnotationRef>(
        AnnotationRefSchema as unknown as SchemaLike<AnnotationRef>,
        raw,
        `body.refs[${i}]`,
      );
      assertRefMatchesPage(r, pageObjectNumber);
      return r;
    });

    const build = (jobId: WorkerJobId): WorkerRequest => ({
      kind: 'annotations.move',
      jobId,
      docId: id,
      pageObjectNumber,
      refs,
      toIndex: rawToIndex,
    });
    const result = await pool.run(id, build, signal);
    if (result.tag !== 'annotations.move') {
      throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload: ${result.tag}`);
    }
    return result.result;
  });

  app.patch(`${wirePaths.documents}/:id/pages/:pon/annotations/:annotKey`, async (req, _reply) => {
    const tenantId = requireTenant(req);
    const { id, pon, annotKey } = req.params as {
      id: string;
      pon: string;
      annotKey: string;
    };
    const pageObjectNumber = parsePageObjectNumber(pon);
    store.requireOwned(id, tenantId);
    const signal = abortSignalFromRequest(req);

    if (annotKey === 'index') {
      // Body is either an update ({ ref, patch }) or a delete ({ ref, op: 'delete' }).
      const body = req.body as Record<string, unknown> | null | undefined;
      const ref = parseOrInvalidArg<AnnotationRef>(
        AnnotationRefSchema as unknown as SchemaLike<AnnotationRef>,
        body?.ref,
        'body.ref',
      );
      assertRefMatchesPage(ref, pageObjectNumber);
      if (ref.kind !== 'index') {
        throw new EngineError(
          EngineErrorCode.InvalidArg,
          `annotKey 'index' requires ref.kind === 'index', got '${ref.kind}'`,
        );
      }
      if (body && body.op === 'delete') {
        const build = (jobId: WorkerJobId): WorkerRequest => ({
          kind: 'annotations.delete',
          jobId,
          docId: id,
          ref,
        });
        const result = await pool.run(id, build, signal);
        if (result.tag !== 'annotations.delete') {
          throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload: ${result.tag}`);
        }
        return result.result;
      }
      const patch = parseOrInvalidArg<AnnotationPatch>(
        AnnotationPatchSchema as unknown as SchemaLike<AnnotationPatch>,
        body?.patch,
        'body.patch',
      );
      const build = (jobId: WorkerJobId): WorkerRequest => ({
        kind: 'annotations.update',
        jobId,
        docId: id,
        ref,
        patch,
      });
      const result = await pool.run(id, build, signal);
      if (result.tag !== 'annotations.update') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload: ${result.tag}`);
      }
      return result.result;
    }

    // Stable-id PATCH: body is { patch }.
    const ref = refFromKey(annotKey, pageObjectNumber);
    const body = req.body as Record<string, unknown> | null | undefined;
    const patch = parseOrInvalidArg<AnnotationPatch>(
      AnnotationPatchSchema as unknown as SchemaLike<AnnotationPatch>,
      body?.patch,
      'body.patch',
    );
    const build = (jobId: WorkerJobId): WorkerRequest => ({
      kind: 'annotations.update',
      jobId,
      docId: id,
      ref,
      patch,
    });
    const result = await pool.run(id, build, signal);
    if (result.tag !== 'annotations.update') {
      throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload: ${result.tag}`);
    }
    return result.result;
  });

  app.delete(`${wirePaths.documents}/:id/pages/:pon/annotations/:annotKey`, async (req, _reply) => {
    const tenantId = requireTenant(req);
    const { id, pon, annotKey } = req.params as {
      id: string;
      pon: string;
      annotKey: string;
    };
    const pageObjectNumber = parsePageObjectNumber(pon);
    store.requireOwned(id, tenantId);
    const signal = abortSignalFromRequest(req);

    if (annotKey === 'index') {
      throw new EngineError(
        EngineErrorCode.InvalidArg,
        `cannot DELETE by index; use PATCH with { ref, op: 'delete' } so the revision token can be validated`,
      );
    }
    const ref = refFromKey(annotKey, pageObjectNumber);
    const build = (jobId: WorkerJobId): WorkerRequest => ({
      kind: 'annotations.delete',
      jobId,
      docId: id,
      ref,
    });
    const result = await pool.run(id, build, signal);
    if (result.tag !== 'annotations.delete') {
      throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload: ${result.tag}`);
    }
    return result.result;
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

function refFromKey(annotKey: string, pageObjectNumber: number): AnnotationRef {
  const stableId = decodeStableIdKey(annotKey);
  if (!stableId) {
    throw new EngineError(
      EngineErrorCode.InvalidArg,
      `annotKey '${annotKey}' is not a valid stable-id key (expected 'obj:N' or 'nm:VALUE')`,
    );
  }
  if (stableId.kind === 'objectNumber') {
    return { kind: 'objectNumber', pageObjectNumber, annotObjectNumber: stableId.value };
  }
  return { kind: 'nm', pageObjectNumber, nm: stableId.value };
}

function assertRefMatchesPage(ref: AnnotationRef, pageObjectNumber: number): void {
  if (ref.pageObjectNumber !== pageObjectNumber) {
    throw new EngineError(
      EngineErrorCode.InvalidArg,
      `ref.pageObjectNumber ${ref.pageObjectNumber} != path :pon ${pageObjectNumber}`,
    );
  }
}
