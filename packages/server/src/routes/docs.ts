import type { FastifyInstance } from 'fastify';
import {
  EngineError,
  EngineErrorCode,
  wirePack,
  type PageState,
  type WorkerJobId,
} from '@embedpdf/engine-core/runtime';
import { wirePaths, type ManifestPage } from '@embedpdf/engine-core/wire';
import { requireDocAccess, requireLayerDocAccess } from '../app/jwt-plugin';
import type { DocumentService } from '../services/DocumentService';
import type { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import { abortSignalFromRequest } from './_helpers';

/** Long-cache header for content-addressed (versioned) URLs. */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/** No-store header for the one un-versioned endpoint (`/head`). */
const NO_STORE = 'private, no-store';

export interface DocsRouteDeps {
  service: DocumentService;
  pool: WorkerThreadPool;
}

/**
 * Phase 3 + 4 doc-scoped read routes. `requireDocAccess(req, docId,
 * needed)` accepts two token classes:
 *
 *   - DocUserClaims with matching `doc_id` AND a `DocScope` covering
 *     one of `needed` (or `*`).
 *   - TenantClaims with `docs.read` or `*` — the tenant owns every
 *     doc in their tenant, and the service layer enforces the
 *     doc-tenant binding via `documents.requireOwned(docId, tenantId)`.
 *
 * Routes:
 *
 *   GET  /v1/docs/:docId/head                            -> DocumentHead
 *                                                          private, no-store
 *   GET  /v1/docs/:docId/v:D/manifest                    -> DocumentManifest
 *                                                          public, immutable
 *   GET  /v1/docs/:docId/pages/:pon/v:P/text             -> PageTextSnapshot
 *                                                          public, immutable
 *   GET  /v1/docs/:docId/pages/:pon/v:A/annotations      -> AnnotationListPageSnapshot
 *                                                          public, immutable
 *   POST /v1/warm                                        -> { warmed: true }
 *
 * Every versioned URL is content-addressed: its bytes are stable for
 * the lifetime of the version, so the CDN caches them for a year.
 * The mutation handler in Phase 5 bumps the versioning integers,
 * which automatically invalidates by rewriting the URL. No purge,
 * no SWR, no risk of serving stale.
 *
 * All four reads only require `doc.read`. Render + mutation routes
 * arrive in later slices and use stricter scopes (`doc.annotate`,
 * `doc.edit-pages`).
 */
export async function registerDocsRoutes(app: FastifyInstance, deps: DocsRouteDeps): Promise<void> {
  const { service, pool } = deps;

  app.get('/v1/docs/:docId/head', async (req, reply) => {
    const { docId } = req.params as { docId: string };
    const { tenantId, sub } = requireDocAccess(req, docId, ['doc.read']);
    const head = await service.openOnPool({ tenantId, sub }, docId);
    // The only un-versioned read endpoint: clients must not cache it
    // (CDN included). Every other versioned URL downstream embeds
    // the pointer's contents, so they get `immutable` instead.
    reply.header('Cache-Control', NO_STORE);
    return head;
  });

  app.get('/v1/docs/:docId/v:D/manifest', async (req, reply) => {
    const { docId, D } = req.params as { docId: string; D: string };
    const { tenantId, sub } = requireDocAccess(req, docId, ['doc.read']);
    // Phase 4: docVersion is always 1, but the URL is already
    // content-addressed so we set the long-cache header now. Phase
    // 5's mutation handler bumps `:D` on every mutation, which
    // automatically invalidates any cached copy by rewriting the
    // URL — no purge, no SWR, no risk of serving stale.
    const requested = parseVersionPathSegment(D, 'docVersion');
    const manifest = await service.getManifest({ tenantId, sub }, docId);
    if (requested !== manifest.docVersion) {
      reply.header('Cache-Control', NO_STORE);
      throw new EngineError(
        EngineErrorCode.NotFound,
        `manifest version ${requested} no longer current (current=${manifest.docVersion})`,
      );
    }
    reply.header('Cache-Control', IMMUTABLE_CACHE);
    return manifest;
  });

  app.get('/v1/docs/:docId/manifest', async (req, reply) => {
    const { docId } = req.params as { docId: string };
    const { tenantId, sub } = requireDocAccess(req, docId, ['doc.read']);
    const manifest = await service.getManifest({ tenantId, sub }, docId);
    reply.header('Cache-Control', NO_STORE);
    return manifest;
  });

  app.get('/v1/docs/:docId/layers/:layerName/head', async (req, reply) => {
    const { docId, layerName } = req.params as { docId: string; layerName: string };
    const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    const head = await service.getLayerHead({ tenantId, sub }, docId, layerName);
    reply.header('Cache-Control', NO_STORE);
    return head;
  });

  app.get('/v1/docs/:docId/layers/:layerName/v:D/manifest', async (req, reply) => {
    const { docId, layerName, D } = req.params as {
      docId: string;
      layerName: string;
      D: string;
    };
    const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    const requested = parseVersionPathSegment(D, 'layerDocVersion');
    const manifest = await service.getLayerManifest({ tenantId, sub }, docId, layerName);
    if (requested !== manifest.docVersion) {
      reply.header('Cache-Control', NO_STORE);
      throw new EngineError(
        EngineErrorCode.NotFound,
        `layer manifest version ${requested} no longer current (current=${manifest.docVersion})`,
      );
    }
    reply.header('Cache-Control', IMMUTABLE_CACHE);
    return manifest;
  });

  app.get('/v1/docs/:docId/layers/:layerName/manifest', async (req, reply) => {
    const { docId, layerName } = req.params as { docId: string; layerName: string };
    const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    const manifest = await service.getLayerManifest({ tenantId, sub }, docId, layerName);
    reply.header('Cache-Control', NO_STORE);
    return manifest;
  });

  app.get('/v1/docs/:docId/layers/:layerName/v:D/metadata', async (req, reply) => {
    const { docId, layerName, D } = req.params as {
      docId: string;
      layerName: string;
      D: string;
    };
    const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    const requested = parseVersionPathSegment(D, 'layerDocVersion');
    const head = await service.getLayerHead({ tenantId, sub }, docId, layerName);
    if (requested !== head.docVersion) {
      reply.header('Cache-Control', NO_STORE);
      throw new EngineError(
        EngineErrorCode.NotFound,
        `layer metadata version ${requested} no longer current (current=${head.docVersion})`,
      );
    }
    const signal = abortSignalFromRequest(req);
    const metadata = await service.readLayerMetadata({ tenantId, sub }, docId, layerName, signal);
    reply.header('Cache-Control', IMMUTABLE_CACHE);
    return metadata;
  });

  app.get('/v1/docs/:docId/pages/:pon/v:P/text', async (req, reply) => {
    const { docId, pon, P } = req.params as { docId: string; pon: string; P: string };
    const { tenantId, sub } = requireDocAccess(req, docId, ['doc.read']);
    const pageObjectNumber = parsePageObjectNumber(pon);
    const requested = parseVersionPathSegment(P, 'contentVersion');
    const signal = abortSignalFromRequest(req);

    const manifest = await service.getManifest({ tenantId, sub }, docId);
    const page = manifest.pages.find((p) => p.pageObjectNumber === pageObjectNumber);
    if (!page) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `no page with object number ${pageObjectNumber} in document ${docId}`,
      );
    }
    if (requested !== page.contentVersion) {
      reply.header('Cache-Control', NO_STORE);
      throw new EngineError(
        EngineErrorCode.NotFound,
        `text version ${requested} no longer current (current=${page.contentVersion}) for page ${pageObjectNumber}`,
      );
    }

    const build = (jobId: WorkerJobId) =>
      wirePack({
        kind: 'pages.text' as const,
        jobId,
        docId,
        pageObjectNumber,
      });
    const result = await pool.run(docId, build, signal);
    if (result.tag !== 'pages.text') {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `unexpected pages.text payload: ${result.tag}`,
      );
    }
    reply.header('Cache-Control', IMMUTABLE_CACHE);
    return {
      ...result.snapshot,
      pageState: toPageState(page),
    };
  });

  app.get('/v1/docs/:docId/layers/:layerName/pages/:pon/v:P/text', async (req, reply) => {
    const { docId, layerName, pon, P } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
      P: string;
    };
    const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    const pageObjectNumber = parsePageObjectNumber(pon);
    const requested = parseVersionPathSegment(P, 'contentVersion');
    const signal = abortSignalFromRequest(req);

    const manifest = await service.getLayerManifest({ tenantId, sub }, docId, layerName);
    const page = manifest.pages.find((p) => p.pageObjectNumber === pageObjectNumber);
    if (!page) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `no page with object number ${pageObjectNumber} in layer ${layerName} for document ${docId}`,
      );
    }
    if (requested !== page.contentVersion) {
      reply.header('Cache-Control', NO_STORE);
      throw new EngineError(
        EngineErrorCode.NotFound,
        `layer text version ${requested} no longer current (current=${page.contentVersion}) for page ${pageObjectNumber}`,
      );
    }

    await service.ensureLayerOnPool({ tenantId, sub }, docId, layerName);
    const build = (jobId: WorkerJobId) =>
      wirePack({
        kind: 'pages.text' as const,
        jobId,
        docId,
        layerName,
        pageObjectNumber,
      });
    const result = await pool.run(docId, build, signal);
    if (result.tag !== 'pages.text') {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `unexpected layer pages.text payload: ${result.tag}`,
      );
    }
    reply.header('Cache-Control', IMMUTABLE_CACHE);
    return {
      ...result.snapshot,
      pageState: toPageState(page),
    };
  });

  app.get('/v1/docs/:docId/pages/:pon/text', async (req, reply) => {
    const { docId, pon } = req.params as { docId: string; pon: string };
    const { tenantId, sub } = requireDocAccess(req, docId, ['doc.read']);
    const pageObjectNumber = parsePageObjectNumber(pon);
    const signal = abortSignalFromRequest(req);

    const manifest = await service.getManifest({ tenantId, sub }, docId);
    const page = manifest.pages.find((p) => p.pageObjectNumber === pageObjectNumber);
    if (!page) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `no page with object number ${pageObjectNumber} in document ${docId}`,
      );
    }

    const build = (jobId: WorkerJobId) =>
      wirePack({
        kind: 'pages.text' as const,
        jobId,
        docId,
        pageObjectNumber,
      });
    const result = await pool.run(docId, build, signal);
    if (result.tag !== 'pages.text') {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `unexpected pages.text payload: ${result.tag}`,
      );
    }
    reply.header('Cache-Control', NO_STORE);
    return {
      ...result.snapshot,
      pageState: toPageState(page),
    };
  });

  app.get('/v1/docs/:docId/layers/:layerName/pages/:pon/v:A/annotations', async (req, reply) => {
    const { docId, layerName, pon, A } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
      A: string;
    };
    const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    const pageObjectNumber = parsePageObjectNumber(pon);
    const requested = parseVersionPathSegment(A, 'annotationVersion');
    const signal = abortSignalFromRequest(req);

    const manifest = await service.getLayerManifest({ tenantId, sub }, docId, layerName);
    const page = manifest.pages.find((p) => p.pageObjectNumber === pageObjectNumber);
    if (!page) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `no page with object number ${pageObjectNumber} in layer ${layerName} for document ${docId}`,
      );
    }
    if (requested !== page.annotationVersion) {
      reply.header('Cache-Control', NO_STORE);
      throw new EngineError(
        EngineErrorCode.NotFound,
        `layer annotation version ${requested} no longer current (current=${page.annotationVersion}) for page ${pageObjectNumber}`,
      );
    }

    await service.ensureLayerOnPool({ tenantId, sub }, docId, layerName);
    const build = (jobId: WorkerJobId) =>
      wirePack({
        kind: 'annotations.listFullPage' as const,
        jobId,
        docId,
        layerName,
        pageObjectNumber,
      });
    const result = await pool.run(docId, build, signal);
    if (result.tag !== 'annotations.listFullPage') {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `unexpected layer annotations.listFullPage payload: ${result.tag}`,
      );
    }
    reply.header('Cache-Control', IMMUTABLE_CACHE);
    return {
      ...result.snapshot,
      pageState: toPageState(page),
    };
  });

  app.get('/v1/docs/:docId/pages/:pon/v:A/annotations', async (req, reply) => {
    const { docId, pon, A } = req.params as { docId: string; pon: string; A: string };
    const { tenantId, sub } = requireDocAccess(req, docId, ['doc.read']);
    const pageObjectNumber = parsePageObjectNumber(pon);
    const requested = parseVersionPathSegment(A, 'annotationVersion');
    const signal = abortSignalFromRequest(req);

    const manifest = await service.getManifest({ tenantId, sub }, docId);
    const page = manifest.pages.find((p) => p.pageObjectNumber === pageObjectNumber);
    if (!page) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `no page with object number ${pageObjectNumber} in document ${docId}`,
      );
    }
    if (requested !== page.annotationVersion) {
      reply.header('Cache-Control', NO_STORE);
      throw new EngineError(
        EngineErrorCode.NotFound,
        `annotation version ${requested} no longer current (current=${page.annotationVersion}) for page ${pageObjectNumber}`,
      );
    }

    const build = (jobId: WorkerJobId) =>
      wirePack({
        kind: 'annotations.listFullPage' as const,
        jobId,
        docId,
        pageObjectNumber,
      });
    const result = await pool.run(docId, build, signal);
    if (result.tag !== 'annotations.listFullPage') {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `unexpected annotations.listFullPage payload: ${result.tag}`,
      );
    }
    reply.header('Cache-Control', IMMUTABLE_CACHE);
    return {
      ...result.snapshot,
      pageState: toPageState(page),
    };
  });

  app.get('/v1/docs/:docId/pages/:pon/annotations', async (req, reply) => {
    const { docId, pon } = req.params as { docId: string; pon: string };
    const { tenantId, sub } = requireDocAccess(req, docId, ['doc.read']);
    const pageObjectNumber = parsePageObjectNumber(pon);
    const signal = abortSignalFromRequest(req);

    const manifest = await service.getManifest({ tenantId, sub }, docId);
    const page = manifest.pages.find((p) => p.pageObjectNumber === pageObjectNumber);
    if (!page) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `no page with object number ${pageObjectNumber} in document ${docId}`,
      );
    }

    const build = (jobId: WorkerJobId) =>
      wirePack({
        kind: 'annotations.listFullPage' as const,
        jobId,
        docId,
        pageObjectNumber,
      });
    const result = await pool.run(docId, build, signal);
    if (result.tag !== 'annotations.listFullPage') {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `unexpected annotations.listFullPage payload: ${result.tag}`,
      );
    }
    reply.header('Cache-Control', NO_STORE);
    return {
      ...result.snapshot,
      pageState: toPageState(page),
    };
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

function toPageState(page: ManifestPage): PageState {
  return {
    pageObjectNumber: page.pageObjectNumber,
    pageIndex: page.pageIndex,
    revision: page.revision,
    weakAnnotationState: page.weakAnnotationState,
    hasAnyWeakAnnotations: page.hasAnyWeakAnnotations,
  };
}

function parseVersionPathSegment(raw: string, label: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new EngineError(
      EngineErrorCode.InvalidArg,
      `${label} path expects an integer version, got "${raw}"`,
    );
  }
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new EngineError(
      EngineErrorCode.InvalidArg,
      `${label} must be a positive integer, got ${raw}`,
    );
  }
  return n;
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
