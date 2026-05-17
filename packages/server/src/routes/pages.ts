import type { FastifyInstance } from 'fastify';
import {
  EngineError,
  EngineErrorCode,
  wirePack,
  type PageMoveInput,
  type WorkerJobId,
} from '@embedpdf/engine-core/runtime';
import { PageMoveInputSchema, type ManifestPage } from '@embedpdf/engine-core/wire';
import { requireDocAccess, requireLayerDocAccess } from '../app/jwt-plugin';
import type { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import type { DocumentService, OpenContext } from '../services/DocumentService';
import type { LayerService } from '../services/LayerService';
import {
  abortSignalFromRequest,
  parseOrInvalidArg,
  parsePageObjectNumber,
  parseVersionPathSegment,
  setImmutableCache,
  setNoStore,
  toPageState,
  type SchemaLike,
} from './_helpers';

interface PageRouteDeps {
  documentService: DocumentService;
  layerService: LayerService;
  pool: WorkerThreadPool;
}

type ReadScope =
  | { kind: 'base'; ctx: OpenContext; docId: string }
  | { kind: 'layer'; ctx: OpenContext; docId: string; layerName: string };

export async function registerPageRoutes(app: FastifyInstance, deps: PageRouteDeps): Promise<void> {
  const { documentService, layerService, pool } = deps;

  app.get('/v1/docs/:docId/pages/:pon/v:P/text', async (req, reply) => {
    const { docId, pon, P } = req.params as { docId: string; pon: string; P: string };
    const ctx = requireDocAccess(req, docId, ['doc.read']);
    return readPageText({
      documentService,
      pool,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'base', ctx, docId },
      pageObjectNumber: parsePageObjectNumber(pon),
      requestedVersion: parseVersionPathSegment(P, 'contentVersion'),
    });
  });

  app.get('/v1/docs/:docId/pages/:pon/text', async (req, reply) => {
    const { docId, pon } = req.params as { docId: string; pon: string };
    const ctx = requireDocAccess(req, docId, ['doc.read']);
    return readPageText({
      documentService,
      pool,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'base', ctx, docId },
      pageObjectNumber: parsePageObjectNumber(pon),
    });
  });

  app.get('/v1/docs/:docId/layers/:layerName/pages/:pon/v:P/text', async (req, reply) => {
    const { docId, layerName, pon, P } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
      P: string;
    };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    return readPageText({
      documentService,
      pool,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'layer', ctx, docId, layerName },
      pageObjectNumber: parsePageObjectNumber(pon),
      requestedVersion: parseVersionPathSegment(P, 'contentVersion'),
    });
  });

  app.get('/v1/docs/:docId/layers/:layerName/pages/:pon/text', async (req, reply) => {
    const { docId, layerName, pon } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
    };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    return readPageText({
      documentService,
      pool,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'layer', ctx, docId, layerName },
      pageObjectNumber: parsePageObjectNumber(pon),
    });
  });

  app.post('/v1/docs/:docId/layers/:layerName/pages/move', async (req, reply) => {
    const { docId, layerName } = req.params as {
      docId: string;
      layerName: string;
    };
    const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.edit-pages']);
    const body = parseOrInvalidArg<PageMoveInput>(
      PageMoveInputSchema as unknown as SchemaLike<PageMoveInput>,
      req.body,
      'request body',
    );

    setNoStore(reply);
    return layerService.movePages(
      { tenantId, sub },
      {
        docId,
        layerName,
        pageObjectNumbers: body.pageObjectNumbers,
        destIndex: body.destIndex,
      },
      abortSignalFromRequest(req),
    );
  });
}

async function readPageText(input: {
  documentService: DocumentService;
  pool: WorkerThreadPool;
  reply: { header(name: 'Cache-Control', value: string): unknown };
  signal: AbortSignal;
  scope: ReadScope;
  pageObjectNumber: number;
  requestedVersion?: number;
}) {
  const page = await resolvePageForRead(input);
  if (input.requestedVersion !== undefined && input.requestedVersion !== page.contentVersion) {
    setNoStore(input.reply);
    throw new EngineError(
      EngineErrorCode.NotFound,
      `${input.scope.kind === 'layer' ? 'layer ' : ''}text version ${
        input.requestedVersion
      } no longer current (current=${page.contentVersion}) for page ${input.pageObjectNumber}`,
    );
  }

  if (input.scope.kind === 'layer') {
    await input.documentService.ensureLayerOnPool(
      input.scope.ctx,
      input.scope.docId,
      input.scope.layerName,
    );
  }
  const build = (jobId: WorkerJobId) =>
    wirePack({
      kind: 'pages.text' as const,
      jobId,
      docId: input.scope.docId,
      ...(input.scope.kind === 'layer' ? { layerName: input.scope.layerName } : {}),
      pageObjectNumber: input.pageObjectNumber,
    });
  const result = await input.pool.run(input.scope.docId, build, input.signal);
  if (result.tag !== 'pages.text') {
    throw new EngineError(
      EngineErrorCode.WireFormat,
      `unexpected ${input.scope.kind === 'layer' ? 'layer ' : ''}pages.text payload: ${result.tag}`,
    );
  }

  input.requestedVersion === undefined ? setNoStore(input.reply) : setImmutableCache(input.reply);
  return {
    ...result.snapshot,
    pageState: toPageState(page),
  };
}

async function resolvePageForRead(input: {
  documentService: DocumentService;
  scope: ReadScope;
  pageObjectNumber: number;
}): Promise<ManifestPage> {
  const manifest =
    input.scope.kind === 'layer'
      ? await input.documentService.getLayerManifest(
          input.scope.ctx,
          input.scope.docId,
          input.scope.layerName,
        )
      : await input.documentService.getManifest(input.scope.ctx, input.scope.docId);
  const page = manifest.pages.find((p) => p.pageObjectNumber === input.pageObjectNumber);
  if (page) {
    return page;
  }
  throw new EngineError(
    EngineErrorCode.NotFound,
    input.scope.kind === 'layer'
      ? `no page with object number ${input.pageObjectNumber} in layer ${input.scope.layerName} for document ${input.scope.docId}`
      : `no page with object number ${input.pageObjectNumber} in document ${input.scope.docId}`,
  );
}
