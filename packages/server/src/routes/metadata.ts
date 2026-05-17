import type { FastifyInstance } from 'fastify';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core/runtime';
import { requireLayerDocAccess } from '../app/jwt-plugin';
import type { DocumentService } from '../services/DocumentService';
import {
  abortSignalFromRequest,
  parseVersionPathSegment,
  setImmutableCache,
  setNoStore,
} from './_helpers';

interface MetadataRouteDeps {
  service: DocumentService;
}

export async function registerMetadataRoutes(
  app: FastifyInstance,
  deps: MetadataRouteDeps,
): Promise<void> {
  const { service } = deps;

  app.get('/v1/docs/:docId/layers/:layerName/v:D/metadata', async (req, reply) => {
    const { docId, layerName, D } = req.params as {
      docId: string;
      layerName: string;
      D: string;
    };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    const requested = parseVersionPathSegment(D, 'layerDocVersion');
    const head = await service.getLayerHead(ctx, docId, layerName);
    if (requested !== head.docVersion) {
      setNoStore(reply);
      throw new EngineError(
        EngineErrorCode.NotFound,
        `layer metadata version ${requested} no longer current (current=${head.docVersion})`,
      );
    }
    const metadata = await service.readLayerMetadata(
      ctx,
      docId,
      layerName,
      abortSignalFromRequest(req),
    );
    setImmutableCache(reply);
    return metadata;
  });

  app.get('/v1/docs/:docId/layers/:layerName/metadata', async (req, reply) => {
    const { docId, layerName } = req.params as {
      docId: string;
      layerName: string;
    };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    const metadata = await service.readLayerMetadata(
      ctx,
      docId,
      layerName,
      abortSignalFromRequest(req),
    );
    setNoStore(reply);
    return metadata;
  });
}
