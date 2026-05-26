import { createReadStream } from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  DEFAULT_PDF_SAVE_MODE,
  EngineError,
  EngineErrorCode,
  type PdfSaveMode,
} from '@embedpdf/engine-core/runtime';
import {
  decodeDocToken,
  decodeDownloadToken,
  PdfSaveModeSchema,
  wirePaths,
} from '@embedpdf/engine-core/wire';
import { requireDocAccess, requireLayerDocAccess } from '../app/jwt-plugin';
import type { DocumentService, SavedPdfFile } from '../services/DocumentService';
import { parseTokenOrInvalidArg, setImmutableCache, setNoStore } from './_helpers';

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
    const head = await service.getHead(ctx, docId);
    setNoStore(reply);
    return head;
  });

  app.get('/v1/docs/:docId/manifest@:token', async (req, reply) => {
    const { docId, token } = req.params as { docId: string; token: string };
    const ctx = requireDocAccess(req, docId, ['doc.read']);
    const requested = parseTokenOrInvalidArg(decodeDocToken, token, 'docVersion token');
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

  app.get('/v1/docs/:docId/layers/:layerName/manifest@:token', async (req, reply) => {
    const { docId, layerName, token } = req.params as {
      docId: string;
      layerName: string;
      token: string;
    };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    const requested = parseTokenOrInvalidArg(decodeDocToken, token, 'layerDocVersion token');
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

  app.get('/v1/docs/:docId/layers/:layerName/download@:token', async (req, reply) => {
    const { docId, layerName, token } = req.params as {
      docId: string;
      layerName: string;
      token: string;
    };
    rejectQueryParamsOnTokenUrl(req.query);
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.download']);
    const requested = parseTokenOrInvalidArg(decodeDownloadToken, token, 'download token');
    const head = await service.getLayerHead(ctx, docId, layerName);
    if (requested.docVersion !== head.docVersion) {
      setNoStore(reply);
      throw new EngineError(
        EngineErrorCode.NotFound,
        `download version ${requested.docVersion} no longer current (current=${head.docVersion})`,
      );
    }
    const file = await service.saveLayerDownloadToTemp(ctx, docId, layerName, requested.mode);
    return sendDownload(reply, file, docId, layerName, requested.mode, 'immutable');
  });

  app.get('/v1/docs/:docId/layers/:layerName/download', async (req, reply) => {
    const { docId, layerName } = req.params as { docId: string; layerName: string };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.download']);
    const mode = parseDownloadMode(req.query);
    const file = await service.saveLayerDownloadToTemp(ctx, docId, layerName, mode);
    return sendDownload(reply, file, docId, layerName, mode, 'no-store');
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

function rejectQueryParamsOnTokenUrl(query: unknown): void {
  if (query && typeof query === 'object' && Object.keys(query).length > 0) {
    throw new EngineError(
      EngineErrorCode.InvalidArg,
      'versioned download URLs must encode download options in the path token, not query params',
    );
  }
}

function sendDownload(
  reply: FastifyReply,
  file: SavedPdfFile,
  docId: string,
  layerName: string,
  mode: PdfSaveMode,
  cache: 'immutable' | 'no-store',
) {
  cache === 'immutable' ? setImmutableCache(reply) : setNoStore(reply);
  reply.header('Content-Type', 'application/pdf');
  reply.header('Content-Length', String(file.size));
  reply.header(
    'Content-Disposition',
    `attachment; filename="${downloadFileName(docId, layerName, mode)}"`,
  );

  const stream = createReadStream(file.path);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    void file.cleanup();
  };
  stream.once('close', cleanup);
  stream.once('error', cleanup);
  reply.raw.once('close', cleanup);
  return reply.send(stream);
}

function parseDownloadMode(query: unknown): PdfSaveMode {
  const mode = query && typeof query === 'object' ? (query as { mode?: unknown }).mode : undefined;
  if (mode === undefined) return DEFAULT_PDF_SAVE_MODE;
  const parsed = PdfSaveModeSchema.safeParse(mode);
  if (!parsed.success) {
    throw new EngineError(
      EngineErrorCode.InvalidArg,
      'query.mode must be either "incremental" or "rewrite"',
    );
  }
  return parsed.data;
}

function downloadFileName(docId: string, layerName: string, mode: PdfSaveMode): string {
  return `${safeHeaderFilePart(docId)}-${safeHeaderFilePart(layerName)}-${mode}.pdf`;
}

function safeHeaderFilePart(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'document';
}
