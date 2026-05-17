import type { FastifyInstance } from 'fastify';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core/runtime';
import { wirePaths } from '@embedpdf/engine-core/wire';
import { requireDocAccess, requireLayerDocAccess } from '../app/jwt-plugin';
import type { DocumentService } from '../services/DocumentService';
import { parseVersionPathSegment, setImmutableCache, setNoStore } from './_helpers';

export interface DocsRouteDeps {
  service: DocumentService;
}

/**
 * Document-level cloud routes: heads, manifests, and pre-warm.
 *
 * Page, annotation, and metadata endpoints live in their domain route
 * modules so reads and writes for the same concept stay together.
 */
export async function registerDocsRoutes(app: FastifyInstance, deps: DocsRouteDeps): Promise<void> {
  const { service } = deps;

  app.get('/v1/docs/:docId/head', async (req, reply) => {
    const { docId } = req.params as { docId: string };
    const ctx = requireDocAccess(req, docId, ['doc.read']);
    const head = await service.openOnPool(ctx, docId);
    setNoStore(reply);
    return head;
  });

  app.get('/v1/docs/:docId/v:D/manifest', async (req, reply) => {
    const { docId, D } = req.params as { docId: string; D: string };
    const ctx = requireDocAccess(req, docId, ['doc.read']);
    const requested = parseVersionPathSegment(D, 'docVersion');
    const manifest = await service.getManifest(ctx, docId);
    if (requested !== manifest.docVersion) {
      setNoStore(reply);
      throw new EngineError(
        EngineErrorCode.NotFound,
        `manifest version ${requested} no longer current (current=${manifest.docVersion})`,
      );
    }
    setImmutableCache(reply);
    return manifest;
  });

  app.get('/v1/docs/:docId/manifest', async (req, reply) => {
    const { docId } = req.params as { docId: string };
    const ctx = requireDocAccess(req, docId, ['doc.read']);
    const manifest = await service.getManifest(ctx, docId);
    setNoStore(reply);
    return manifest;
  });

  app.get('/v1/docs/:docId/layers/:layerName/head', async (req, reply) => {
    const { docId, layerName } = req.params as { docId: string; layerName: string };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    const head = await service.getLayerHead(ctx, docId, layerName);
    setNoStore(reply);
    return head;
  });

  app.get('/v1/docs/:docId/layers/:layerName/v:D/manifest', async (req, reply) => {
    const { docId, layerName, D } = req.params as {
      docId: string;
      layerName: string;
      D: string;
    };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    const requested = parseVersionPathSegment(D, 'layerDocVersion');
    const manifest = await service.getLayerManifest(ctx, docId, layerName);
    if (requested !== manifest.docVersion) {
      setNoStore(reply);
      throw new EngineError(
        EngineErrorCode.NotFound,
        `layer manifest version ${requested} no longer current (current=${manifest.docVersion})`,
      );
    }
    setImmutableCache(reply);
    return manifest;
  });

  app.get('/v1/docs/:docId/layers/:layerName/manifest', async (req, reply) => {
    const { docId, layerName } = req.params as { docId: string; layerName: string };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    const manifest = await service.getLayerManifest(ctx, docId, layerName);
    setNoStore(reply);
    return manifest;
  });

  app.post(wirePaths.docWarm, async (req) => {
    const body = (req.body ?? {}) as { docId?: unknown };
    if (typeof body.docId !== 'string' || body.docId.length === 0) {
      throw new EngineError(EngineErrorCode.InvalidArg, `request body missing "docId"`);
    }
    const docId = body.docId;
    const ctx = requireDocAccess(req, docId, ['doc.read']);
    const head = await service.warm(ctx, docId);
    return { warmed: true, head };
  });
}
