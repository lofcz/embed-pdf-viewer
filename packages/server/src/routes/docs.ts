import type { FastifyInstance } from 'fastify';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core/runtime';
import { wirePaths } from '@embedpdf/engine-core/wire';
import { requireDocAccess } from '../app/jwt-plugin';
import type { DocumentService } from '../services/DocumentService';

export interface DocsRouteDeps {
  service: DocumentService;
}

/**
 * Phase 3 doc-scoped routes. `requireDocAccess(req, docId, needed)`
 * accepts two token classes:
 *
 *   - DocUserClaims with matching `doc_id` AND a `DocScope` covering
 *     one of `needed` (or `*`).
 *   - TenantClaims with `docs.read` or `*` — the tenant owns every
 *     doc in their tenant, and the service layer enforces the
 *     doc-tenant binding via `documents.requireOwned(docId, tenantId)`.
 *
 * Routes:
 *
 *   GET  /v1/docs/:docId/head             -> DocumentHead
 *   GET  /v1/docs/:docId/v:D/manifest     -> DocumentManifest
 *   POST /v1/warm                         -> { warmed: true } (body: { docId })
 *
 * All three are read-only and only require `doc.read`.
 *
 * Phase 4 will introduce versioned render / annotation routes
 * under `/v1/docs/:docId/pages/:pon/v:P/...` — those use stricter
 * DocScopes (`doc.annotate`, `doc.edit-pages`).
 */
export async function registerDocsRoutes(app: FastifyInstance, deps: DocsRouteDeps): Promise<void> {
  const { service } = deps;

  app.get('/v1/docs/:docId/head', async (req) => {
    const { docId } = req.params as { docId: string };
    const { tenantId, sub } = requireDocAccess(req, docId, ['doc.read']);
    const head = await service.openOnPool({ tenantId, sub }, docId);
    return head;
  });

  app.get('/v1/docs/:docId/v:D/manifest', async (req) => {
    const { docId, D } = req.params as { docId: string; D: string };
    const { tenantId, sub } = requireDocAccess(req, docId, ['doc.read']);
    // Phase 3: structure version is always 1. The URL still carries
    // `:D` because the cache-busting integer is part of the Phase 4
    // contract; we want to lock the path shape now so SDKs minted
    // today still work after Phase 4 lands. A request for a stale
    // version returns 404 — that's the "this manifest is gone"
    // signal the SDK uses to re-fetch `/head`.
    const requested = parseDocVersion(D);
    const manifest = await service.getManifest({ tenantId, sub }, docId);
    if (requested !== manifest.docStructureVersion) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `manifest version ${requested} no longer current (current=${manifest.docStructureVersion})`,
      );
    }
    return manifest;
  });

  app.post(wirePaths.docWarm, async (req) => {
    const body = (req.body ?? {}) as { docId?: unknown };
    if (typeof body.docId !== 'string' || body.docId.length === 0) {
      throw new EngineError(EngineErrorCode.InvalidArg, `request body missing "docId"`);
    }
    const docId = body.docId;
    const { tenantId, sub } = requireDocAccess(req, docId, ['doc.read']);
    const head = await service.warm({ tenantId, sub }, docId);
    return { warmed: true, head };
  });
}

function parseDocVersion(D: string): number {
  if (!/^\d+$/.test(D)) {
    throw new EngineError(
      EngineErrorCode.InvalidArg,
      `manifest path expects an integer version, got "${D}"`,
    );
  }
  const n = parseInt(D, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new EngineError(
      EngineErrorCode.InvalidArg,
      `manifest version must be a positive integer, got ${D}`,
    );
  }
  return n;
}
