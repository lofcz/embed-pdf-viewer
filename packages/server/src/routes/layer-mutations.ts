import type { FastifyInstance } from 'fastify';
import {
  EngineError,
  EngineErrorCode,
  type AnnotationDraft,
  type AnnotationPatch,
  type AnnotationRef,
} from '@embedpdf/engine-core/runtime';
import {
  AnnotationDraftSchema,
  AnnotationPatchSchema,
  AnnotationRefSchema,
} from '@embedpdf/engine-core/wire';
import { requireLayerDocAccess } from '../app/jwt-plugin';
import type { LayerService } from '../services/LayerService';
import { abortSignalFromRequest, parseOrInvalidArg, type SchemaLike } from './_helpers';
import {
  assertRefMatchesPage,
  parsePageObjectNumber,
  refFromKey,
} from './annotation-route-helpers';

export interface LayerMutationRouteDeps {
  service: LayerService;
}

export async function registerLayerMutationRoutes(
  app: FastifyInstance,
  deps: LayerMutationRouteDeps,
): Promise<void> {
  const { service } = deps;

  app.post('/v1/docs/:docId/layers/:layerName/pages/:pon/annotations', async (req, reply) => {
    const { docId, layerName, pon } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
    };
    const pageObjectNumber = parsePageObjectNumber(pon);
    const { tenantId, sub } = requireLayerDocAccess(req, docId, layerName, ['doc.annotate']);
    const signal = abortSignalFromRequest(req);
    const draft = parseOrInvalidArg<AnnotationDraft>(
      AnnotationDraftSchema as unknown as SchemaLike<AnnotationDraft>,
      req.body,
      'request body',
    );

    reply.header('Cache-Control', 'private, no-store');
    return service.createAnnotation(
      { tenantId, sub },
      { docId, layerName, pageObjectNumber, draft },
      signal,
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
    const signal = abortSignalFromRequest(req);
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

    reply.header('Cache-Control', 'private, no-store');
    return service.moveAnnotations(
      { tenantId, sub },
      { docId, layerName, pageObjectNumber, refs, toIndex: rawToIndex },
      signal,
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
      const signal = abortSignalFromRequest(req);

      if (annotKey === 'index') {
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
        if (body?.op === 'delete') {
          reply.header('Cache-Control', 'private, no-store');
          return service.deleteAnnotation({ tenantId, sub }, { docId, layerName, ref }, signal);
        }

        const patch = parseOrInvalidArg<AnnotationPatch>(
          AnnotationPatchSchema as unknown as SchemaLike<AnnotationPatch>,
          body?.patch,
          'body.patch',
        );
        reply.header('Cache-Control', 'private, no-store');
        return service.updateAnnotation(
          { tenantId, sub },
          { docId, layerName, ref, patch },
          signal,
        );
      }

      const ref = refFromKey(annotKey, pageObjectNumber);
      const body = req.body as Record<string, unknown> | null | undefined;
      const patch = parseOrInvalidArg<AnnotationPatch>(
        AnnotationPatchSchema as unknown as SchemaLike<AnnotationPatch>,
        body?.patch,
        'body.patch',
      );
      reply.header('Cache-Control', 'private, no-store');
      return service.updateAnnotation({ tenantId, sub }, { docId, layerName, ref, patch }, signal);
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
      const signal = abortSignalFromRequest(req);

      if (annotKey === 'index') {
        throw new EngineError(
          EngineErrorCode.InvalidArg,
          "cannot DELETE by index; use PATCH with { ref, op: 'delete' } so the revision token can be validated",
        );
      }

      const ref = refFromKey(annotKey, pageObjectNumber);
      reply.header('Cache-Control', 'private, no-store');
      return service.deleteAnnotation({ tenantId, sub }, { docId, layerName, ref }, signal);
    },
  );
}
