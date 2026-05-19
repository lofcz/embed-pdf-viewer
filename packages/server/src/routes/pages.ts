import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  EngineError,
  EngineErrorCode,
  wirePack,
  type PageNetworkRenderFormat,
  type PageMoveInput,
  type WorkerJobId,
} from '@embedpdf/engine-core/runtime';
import {
  PageMoveInputSchema,
  PageNetworkRenderFormatSchema,
  PageRenderQuerySchema,
  type ManifestPage,
} from '@embedpdf/engine-core/wire';
import { requireDocAccess, requireLayerDocAccess } from '../app/jwt-plugin';
import type { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import type { DocumentService, OpenContext } from '../services/DocumentService';
import type { LayerService } from '../services/LayerService';
import type { SharpImageEncoder } from '../render/SharpImageEncoder';
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
  imageEncoder: SharpImageEncoder;
}

type ReadScope =
  | { kind: 'base'; ctx: OpenContext; docId: string }
  | { kind: 'layer'; ctx: OpenContext; docId: string; layerName: string };

export async function registerPageRoutes(app: FastifyInstance, deps: PageRouteDeps): Promise<void> {
  const { documentService, layerService, pool, imageEncoder } = deps;

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

  app.get('/v1/docs/:docId/pages/:pon/v:P/geometry', async (req, reply) => {
    const { docId, pon, P } = req.params as { docId: string; pon: string; P: string };
    const ctx = requireDocAccess(req, docId, ['doc.read']);
    return readPageGeometry({
      documentService,
      pool,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'base', ctx, docId },
      pageObjectNumber: parsePageObjectNumber(pon),
      requestedVersion: parseVersionPathSegment(P, 'contentVersion'),
    });
  });

  app.get('/v1/docs/:docId/pages/:pon/geometry', async (req, reply) => {
    const { docId, pon } = req.params as { docId: string; pon: string };
    const ctx = requireDocAccess(req, docId, ['doc.read']);
    return readPageGeometry({
      documentService,
      pool,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'base', ctx, docId },
      pageObjectNumber: parsePageObjectNumber(pon),
    });
  });

  app.get('/v1/docs/:docId/pages/:pon/v:P/render/:fmt', async (req, reply) => {
    const { docId, pon, P, fmt } = req.params as {
      docId: string;
      pon: string;
      P: string;
      fmt: string;
    };
    const ctx = requireDocAccess(req, docId, ['doc.read']);
    return renderPageImage({
      documentService,
      pool,
      imageEncoder,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'base', ctx, docId },
      pageObjectNumber: parsePageObjectNumber(pon),
      requestedContentVersion: parseVersionPathSegment(P, 'contentVersion'),
      requestedAnnotationVersion: undefined,
      format: parseOrInvalidArg(PageNetworkRenderFormatSchema, fmt, 'render format'),
      query: req.query,
    });
  });

  app.get('/v1/docs/:docId/pages/:pon/render/:fmt', async (req, reply) => {
    const { docId, pon, fmt } = req.params as { docId: string; pon: string; fmt: string };
    const ctx = requireDocAccess(req, docId, ['doc.read']);
    return renderPageImage({
      documentService,
      pool,
      imageEncoder,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'base', ctx, docId },
      pageObjectNumber: parsePageObjectNumber(pon),
      requestedContentVersion: undefined,
      requestedAnnotationVersion: undefined,
      format: parseOrInvalidArg(PageNetworkRenderFormatSchema, fmt, 'render format'),
      query: req.query,
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

  app.get('/v1/docs/:docId/layers/:layerName/pages/:pon/v:P/geometry', async (req, reply) => {
    const { docId, layerName, pon, P } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
      P: string;
    };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    return readPageGeometry({
      documentService,
      pool,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'layer', ctx, docId, layerName },
      pageObjectNumber: parsePageObjectNumber(pon),
      requestedVersion: parseVersionPathSegment(P, 'contentVersion'),
    });
  });

  app.get('/v1/docs/:docId/layers/:layerName/pages/:pon/geometry', async (req, reply) => {
    const { docId, layerName, pon } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
    };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    return readPageGeometry({
      documentService,
      pool,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'layer', ctx, docId, layerName },
      pageObjectNumber: parsePageObjectNumber(pon),
    });
  });

  app.get('/v1/docs/:docId/layers/:layerName/pages/:pon/v:P/render/:fmt', async (req, reply) => {
    const { docId, layerName, pon, P, fmt } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
      P: string;
      fmt: string;
    };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    return renderPageImage({
      documentService,
      pool,
      imageEncoder,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'layer', ctx, docId, layerName },
      pageObjectNumber: parsePageObjectNumber(pon),
      requestedContentVersion: parseVersionPathSegment(P, 'contentVersion'),
      requestedAnnotationVersion: null,
      format: parseOrInvalidArg(PageNetworkRenderFormatSchema, fmt, 'render format'),
      query: req.query,
    });
  });

  app.get(
    '/v1/docs/:docId/layers/:layerName/pages/:pon/v:P/a/:A/render/:fmt',
    async (req, reply) => {
      const { docId, layerName, pon, P, A, fmt } = req.params as {
        docId: string;
        layerName: string;
        pon: string;
        P: string;
        A: string;
        fmt: string;
      };
      const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
      return renderPageImage({
        documentService,
        pool,
        imageEncoder,
        reply,
        signal: abortSignalFromRequest(req),
        scope: { kind: 'layer', ctx, docId, layerName },
        pageObjectNumber: parsePageObjectNumber(pon),
        requestedContentVersion: parseVersionPathSegment(P, 'contentVersion'),
        requestedAnnotationVersion: parseVersionPathSegment(A, 'annotationVersion'),
        format: parseOrInvalidArg(PageNetworkRenderFormatSchema, fmt, 'render format'),
        query: req.query,
      });
    },
  );

  app.get('/v1/docs/:docId/layers/:layerName/pages/:pon/render/:fmt', async (req, reply) => {
    const { docId, layerName, pon, fmt } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
      fmt: string;
    };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    return renderPageImage({
      documentService,
      pool,
      imageEncoder,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'layer', ctx, docId, layerName },
      pageObjectNumber: parsePageObjectNumber(pon),
      requestedContentVersion: undefined,
      requestedAnnotationVersion: undefined,
      format: parseOrInvalidArg(PageNetworkRenderFormatSchema, fmt, 'render format'),
      query: req.query,
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

async function renderPageImage(input: {
  documentService: DocumentService;
  pool: WorkerThreadPool;
  imageEncoder: SharpImageEncoder;
  reply: FastifyReply;
  signal: AbortSignal;
  scope: ReadScope;
  pageObjectNumber: number;
  requestedContentVersion?: number;
  requestedAnnotationVersion?: number | null;
  format: PageNetworkRenderFormat;
  query: unknown;
}) {
  const page = await resolvePageForRead(input);
  const parsedQuery = parseOrInvalidArg(PageRenderQuerySchema, input.query, 'render query');
  const includeAnnotations =
    input.requestedAnnotationVersion === undefined
      ? (parsedQuery.options.includeAnnotations ?? true)
      : input.requestedAnnotationVersion !== null;

  if (
    input.requestedContentVersion !== undefined &&
    input.requestedContentVersion !== page.cache.contentVersion
  ) {
    setNoStore(input.reply);
    throw new EngineError(
      EngineErrorCode.NotFound,
      `render contentVersion ${input.requestedContentVersion} no longer current (current=${page.cache.contentVersion}) for page ${input.pageObjectNumber}`,
    );
  }

  if (
    input.requestedAnnotationVersion !== undefined &&
    input.requestedAnnotationVersion !== null &&
    input.requestedAnnotationVersion !== page.cache.annotationVersion
  ) {
    setNoStore(input.reply);
    throw new EngineError(
      EngineErrorCode.NotFound,
      `render annotationVersion ${input.requestedAnnotationVersion} no longer current (current=${page.cache.annotationVersion}) for page ${input.pageObjectNumber}`,
    );
  }

  if (input.scope.kind === 'layer') {
    await input.documentService.ensureLayerOnPool(
      input.scope.ctx,
      input.scope.docId,
      input.scope.layerName,
    );
  }

  const renderOptions = { ...parsedQuery.options, includeAnnotations };
  const build = (jobId: WorkerJobId) =>
    wirePack({
      kind: 'pages.render' as const,
      jobId,
      docId: input.scope.docId,
      ...(input.scope.kind === 'layer' ? { layerName: input.scope.layerName } : {}),
      pageObjectNumber: input.pageObjectNumber,
      options: renderOptions,
    });
  const result = await input.pool.run(input.scope.docId, build, input.signal);
  if (result.tag !== 'pages.render') {
    throw new EngineError(
      EngineErrorCode.WireFormat,
      `unexpected layer pages.render payload: ${result.tag}`,
    );
  }

  const encoded = input.imageEncoder.encode(result.raster, {
    format: input.format,
    quality: parsedQuery.quality,
  });
  input.requestedContentVersion === undefined
    ? setNoStore(input.reply)
    : setImmutableCache(input.reply);
  input.reply.type(encoded.contentType);
  input.reply.header('X-EmbedPDF-Image-Width', String(result.raster.width));
  input.reply.header('X-EmbedPDF-Image-Height', String(result.raster.height));
  return input.reply.send(encoded.stream);
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
  if (
    input.requestedVersion !== undefined &&
    input.requestedVersion !== page.cache.contentVersion
  ) {
    setNoStore(input.reply);
    throw new EngineError(
      EngineErrorCode.NotFound,
      `${input.scope.kind === 'layer' ? 'layer ' : ''}text version ${
        input.requestedVersion
      } no longer current (current=${page.cache.contentVersion}) for page ${
        input.pageObjectNumber
      }`,
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

async function readPageGeometry(input: {
  documentService: DocumentService;
  pool: WorkerThreadPool;
  reply: { header(name: 'Cache-Control', value: string): unknown };
  signal: AbortSignal;
  scope: ReadScope;
  pageObjectNumber: number;
  requestedVersion?: number;
}) {
  const page = await resolvePageForRead(input);
  if (
    input.requestedVersion !== undefined &&
    input.requestedVersion !== page.cache.contentVersion
  ) {
    setNoStore(input.reply);
    throw new EngineError(
      EngineErrorCode.NotFound,
      `${input.scope.kind === 'layer' ? 'layer ' : ''}geometry version ${
        input.requestedVersion
      } no longer current (current=${page.cache.contentVersion}) for page ${
        input.pageObjectNumber
      }`,
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
      kind: 'pages.geometry' as const,
      jobId,
      docId: input.scope.docId,
      ...(input.scope.kind === 'layer' ? { layerName: input.scope.layerName } : {}),
      pageObjectNumber: input.pageObjectNumber,
    });
  const result = await input.pool.run(input.scope.docId, build, input.signal);
  if (result.tag !== 'pages.geometry') {
    throw new EngineError(
      EngineErrorCode.WireFormat,
      `unexpected ${
        input.scope.kind === 'layer' ? 'layer ' : ''
      }pages.geometry payload: ${result.tag}`,
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
  const page = manifest.pages.find((p) => p.state.pageObjectNumber === input.pageObjectNumber);
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
