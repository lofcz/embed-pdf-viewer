import type { FastifyInstance } from 'fastify';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core/runtime';
import { decodeDocToken } from '@embedpdf/engine-core/wire';
import { requireLayerDocAccess } from '../app/jwt-plugin';
import type { DocumentService } from '../services/DocumentService';
import {
  abortSignalFromRequest,
  parseTokenOrInvalidArg,
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

  app.get('/v1/docs/:docId/layers/:layerName/metadata@:token', async (req, reply) => {
    const { docId, layerName, token } = req.params as {
      docId: string;
      layerName: string;
      token: string;
    };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    const requested = parseTokenOrInvalidArg(decodeDocToken, token, 'layerDocVersion token');
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
