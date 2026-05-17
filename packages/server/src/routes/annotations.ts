import type { FastifyInstance } from 'fastify';
import {
  EngineError,
  EngineErrorCode,
  wirePack,
  type AnnotationDraft,
  type AnnotationPatch,
  type AnnotationRef,
  type WorkerJobId,
} from '@embedpdf/engine-core/runtime';
import {
  AnnotationDraftSchema,
  AnnotationPatchSchema,
  AnnotationRefSchema,
  WeakAnnotationSessionPagesRequestSchema,
  type ManifestPage,
} from '@embedpdf/engine-core/wire';
import { requireDocAccess, requireLayerDocAccess } from '../app/jwt-plugin';
import type { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import type { CloudRevisionBridge } from '../services/CloudRevisionBridge';
import type { DocumentService, OpenContext } from '../services/DocumentService';
import type { LayerService } from '../services/LayerService';
import type { WeakAnnotationSessionService } from '../services/WeakAnnotationSessionService';
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
import { assertRefMatchesPage, refFromKey } from './annotation-route-helpers';

interface AnnotationRouteDeps {
  documentService: DocumentService;
  layerService: LayerService;
  pool: WorkerThreadPool;
  revisionBridge: CloudRevisionBridge;
  weakAnnotationSessions?: WeakAnnotationSessionService;
}

type ReadScope =
  | { kind: 'base'; ctx: OpenContext; docId: string }
  | { kind: 'layer'; ctx: OpenContext; docId: string; layerName: string };

export async function registerAnnotationRoutes(
  app: FastifyInstance,
  deps: AnnotationRouteDeps,
): Promise<void> {
  const { documentService, layerService, pool, revisionBridge, weakAnnotationSessions } = deps;

  app.get('/v1/docs/:docId/pages/:pon/v:A/annotations', async (req, reply) => {
    const { docId, pon, A } = req.params as { docId: string; pon: string; A: string };
    const ctx = requireDocAccess(req, docId, ['doc.read']);
    return readAnnotations({
      documentService,
      pool,
      revisionBridge,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'base', ctx, docId },
      pageObjectNumber: parsePageObjectNumber(pon),
      requestedVersion: parseVersionPathSegment(A, 'annotationVersion'),
    });
  });

  app.get('/v1/docs/:docId/pages/:pon/annotations', async (req, reply) => {
    const { docId, pon } = req.params as { docId: string; pon: string };
    const ctx = requireDocAccess(req, docId, ['doc.read']);
    return readAnnotations({
      documentService,
      pool,
      revisionBridge,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'base', ctx, docId },
      pageObjectNumber: parsePageObjectNumber(pon),
    });
  });

  app.get('/v1/docs/:docId/layers/:layerName/pages/:pon/v:A/annotations', async (req, reply) => {
    const { docId, layerName, pon, A } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
      A: string;
    };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    return readAnnotations({
      documentService,
      pool,
      revisionBridge,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'layer', ctx, docId, layerName },
      pageObjectNumber: parsePageObjectNumber(pon),
      requestedVersion: parseVersionPathSegment(A, 'annotationVersion'),
    });
  });

  app.get('/v1/docs/:docId/layers/:layerName/pages/:pon/annotations', async (req, reply) => {
    const { docId, layerName, pon } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
    };
    const ctx = requireLayerDocAccess(req, docId, layerName, ['doc.read']);
    return readAnnotations({
      documentService,
      pool,
      revisionBridge,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'layer', ctx, docId, layerName },
      pageObjectNumber: parsePageObjectNumber(pon),
    });
  });

  app.post('/v1/docs/:docId/layers/:layerName/weak-annotation-session', async (req, reply) => {
    const { docId, layerName } = req.params as { docId: string; layerName: string };
    const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.annotate']);
    setNoStore(reply);
    const body = parseOrInvalidArg(
      WeakAnnotationSessionPagesRequestSchema,
      req.body,
      'request body',
    );
    return requireWeakAnnotationSessions(weakAnnotationSessions).begin(
      { tenantId, sub },
      {
        docId,
        layerName,
        pageObjectNumbers: body.pageObjectNumbers,
      },
    );
  });

  app.post(
    '/v1/docs/:docId/layers/:layerName/weak-annotation-session/:sessionId/pages',
    async (req, reply) => {
      const { docId, layerName, sessionId } = req.params as {
        docId: string;
        layerName: string;
        sessionId: string;
      };
      const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.annotate']);
      setNoStore(reply);
      const body = parseOrInvalidArg(
        WeakAnnotationSessionPagesRequestSchema,
        req.body,
        'request body',
      );
      return requireWeakAnnotationSessions(weakAnnotationSessions).updatePages(
        { tenantId, sub },
        {
          docId,
          layerName,
          sessionId,
          pageObjectNumbers: body.pageObjectNumbers,
        },
      );
    },
  );

  app.post(
    '/v1/docs/:docId/layers/:layerName/weak-annotation-session/:sessionId/heartbeat',
    async (req, reply) => {
      const { docId, layerName, sessionId } = req.params as {
        docId: string;
        layerName: string;
        sessionId: string;
      };
      const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.annotate']);
      setNoStore(reply);
      return requireWeakAnnotationSessions(weakAnnotationSessions).heartbeat(
        { tenantId, sub },
        { docId, layerName, sessionId },
      );
    },
  );

  app.delete(
    '/v1/docs/:docId/layers/:layerName/weak-annotation-session/:sessionId',
    async (req, reply) => {
      const { docId, layerName, sessionId } = req.params as {
        docId: string;
        layerName: string;
        sessionId: string;
      };
      const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.annotate']);
      await requireWeakAnnotationSessions(weakAnnotationSessions).release(
        { tenantId, sub },
        { docId, layerName, sessionId },
      );
      setNoStore(reply);
      return reply.code(204).send();
    },
  );

  app.post('/v1/docs/:docId/layers/:layerName/pages/:pon/annotations', async (req, reply) => {
    const { docId, layerName, pon } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
    };
    const pageObjectNumber = parsePageObjectNumber(pon);
    const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.annotate']);
    const draft = parseOrInvalidArg<AnnotationDraft>(
      AnnotationDraftSchema as unknown as SchemaLike<AnnotationDraft>,
      req.body,
      'request body',
    );

    setNoStore(reply);
    return layerService.createAnnotation(
      { tenantId, sub },
      { docId, layerName, pageObjectNumber, draft },
      abortSignalFromRequest(req),
    );
  });

  app.post('/v1/docs/:docId/layers/:layerName/pages/:pon/annotations/move', async (req, reply) => {
    const { docId, layerName, pon } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
    };
    const pageObjectNumber = parsePageObjectNumber(pon);
    const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.annotate']);
    const body = req.body as Record<string, unknown> | null | undefined;
    const rawRefs = body?.refs;
    const rawToIndex = body?.toIndex;
    if (!Array.isArray(rawRefs) || rawRefs.length === 0) {
      throw new EngineError(
        EngineErrorCode.InvalidArg,
        'body.refs: expected non-empty array of AnnotationRef',
      );
    }
    if (typeof rawToIndex !== 'number' || !Number.isInteger(rawToIndex) || rawToIndex < 0) {
      throw new EngineError(
        EngineErrorCode.InvalidArg,
        'body.toIndex: expected non-negative integer',
      );
    }
    const refs: AnnotationRef[] = rawRefs.map((raw, i) => {
      const ref = parseOrInvalidArg<AnnotationRef>(
        AnnotationRefSchema as unknown as SchemaLike<AnnotationRef>,
        raw,
        `body.refs[${i}]`,
      );
      assertRefMatchesPage(ref, pageObjectNumber);
      return ref;
    });

    setNoStore(reply);
    return layerService.moveAnnotations(
      { tenantId, sub },
      { docId, layerName, pageObjectNumber, refs, toIndex: rawToIndex },
      abortSignalFromRequest(req),
    );
  });

  app.patch(
    '/v1/docs/:docId/layers/:layerName/pages/:pon/annotations/:annotKey',
    async (req, reply) => {
      const { docId, layerName, pon, annotKey } = req.params as {
        docId: string;
        layerName: string;
        pon: string;
        annotKey: string;
      };
      const pageObjectNumber = parsePageObjectNumber(pon);
      const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.annotate']);
      const body = req.body as Record<string, unknown> | null | undefined;

      if (annotKey === 'index') {
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
        if (body?.op === 'delete') {
          setNoStore(reply);
          return layerService.deleteAnnotation(
            { tenantId, sub },
            { docId, layerName, ref },
            abortSignalFromRequest(req),
          );
        }

        const patch = parseOrInvalidArg<AnnotationPatch>(
          AnnotationPatchSchema as unknown as SchemaLike<AnnotationPatch>,
          body?.patch,
          'body.patch',
        );
        setNoStore(reply);
        return layerService.updateAnnotation(
          { tenantId, sub },
          { docId, layerName, ref, patch },
          abortSignalFromRequest(req),
        );
      }

      const ref = refFromKey(annotKey, pageObjectNumber);
      const patch = parseOrInvalidArg<AnnotationPatch>(
        AnnotationPatchSchema as unknown as SchemaLike<AnnotationPatch>,
        body?.patch,
        'body.patch',
      );
      setNoStore(reply);
      return layerService.updateAnnotation(
        { tenantId, sub },
        { docId, layerName, ref, patch },
        abortSignalFromRequest(req),
      );
    },
  );

  app.delete(
    '/v1/docs/:docId/layers/:layerName/pages/:pon/annotations/:annotKey',
    async (req, reply) => {
      const { docId, layerName, pon, annotKey } = req.params as {
        docId: string;
        layerName: string;
        pon: string;
        annotKey: string;
      };
      const pageObjectNumber = parsePageObjectNumber(pon);
      const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.annotate']);

      if (annotKey === 'index') {
        throw new EngineError(
          EngineErrorCode.InvalidArg,
          "cannot DELETE by index; use PATCH with { ref, op: 'delete' } so the revision token can be validated",
        );
      }

      setNoStore(reply);
      return layerService.deleteAnnotation(
        { tenantId, sub },
        { docId, layerName, ref: refFromKey(annotKey, pageObjectNumber) },
        abortSignalFromRequest(req),
      );
    },
  );
}

function requireWeakAnnotationSessions(
  service: WeakAnnotationSessionService | undefined,
): WeakAnnotationSessionService {
  if (!service) {
    throw new EngineError(
      EngineErrorCode.NotImplemented,
      'weak annotation sessions are not configured',
    );
  }
  return service;
}

async function readAnnotations(input: {
  documentService: DocumentService;
  pool: WorkerThreadPool;
  revisionBridge: CloudRevisionBridge;
  reply: { header(name: 'Cache-Control', value: string): unknown };
  signal: AbortSignal;
  scope: ReadScope;
  pageObjectNumber: number;
  requestedVersion?: number;
}) {
  const page = await resolvePageForRead(input);
  if (input.requestedVersion !== undefined && input.requestedVersion !== page.annotationVersion) {
    setNoStore(input.reply);
    throw new EngineError(
      EngineErrorCode.NotFound,
      `${input.scope.kind === 'layer' ? 'layer ' : ''}annotation version ${
        input.requestedVersion
      } no longer current (current=${page.annotationVersion}) for page ${input.pageObjectNumber}`,
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
      kind: 'annotations.listFullPage' as const,
      jobId,
      docId: input.scope.docId,
      ...(input.scope.kind === 'layer' ? { layerName: input.scope.layerName } : {}),
      pageObjectNumber: input.pageObjectNumber,
    });
  const result = await input.pool.run(input.scope.docId, build, input.signal);
  if (result.tag !== 'annotations.listFullPage') {
    throw new EngineError(
      EngineErrorCode.WireFormat,
      `unexpected ${
        input.scope.kind === 'layer' ? 'layer ' : ''
      }annotations.listFullPage payload: ${result.tag}`,
    );
  }

  input.requestedVersion === undefined ? setNoStore(input.reply) : setImmutableCache(input.reply);
  return input.revisionBridge.decorateAnnotationSnapshot(toPageState(page), result.snapshot);
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
