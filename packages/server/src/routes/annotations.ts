import type { FastifyInstance } from 'fastify';
import {
  EngineError,
  EngineErrorCode,
  checkSetGroup,
  wirePack,
  type AnnotationActor,
  type AnnotationDraft,
  type AnnotationPatch,
  type AnnotationRef,
  type CollabTarget,
  type PdfBits,
  type WorkerJobId,
} from '@embedpdf/engine-core/runtime';
import {
  AnnotationDraftSchema,
  AnnotationPatchSchema,
  AnnotationRefSchema,
  decodeAnnotationToken,
  WeakAnnotationSessionPagesRequestSchema,
  type ManifestPage,
} from '@embedpdf/engine-core/wire';
import {
  requireDocAccessOnly,
  requireLayerCapability,
  requireLayerCollabAction,
  requireLayerDocAccessOnly,
  requireLayerResource,
  requireResource,
  type RequestJwtContext,
} from '../app/jwt-plugin';
import type { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import type { CloudRevisionBridge } from '../services/CloudRevisionBridge';
import type { DocumentService, OpenContext } from '../services/DocumentService';
import type { LayerService } from '../services/LayerService';
import type { WeakAnnotationSessionService } from '../services/WeakAnnotationSessionService';
import {
  abortSignalFromRequest,
  parseOrInvalidArg,
  parsePageObjectNumber,
  parseTokenOrInvalidArg,
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

  app.get('/v1/docs/:docId/pages/:pon/annotations@:token', async (req, reply) => {
    const { docId, pon, token } = req.params as { docId: string; pon: string; token: string };
    const accessCtx = requireDocAccessOnly(req, docId);
    const pdfBits = await documentService.getEffectivePdfBits(accessCtx, docId);
    const ctx = requireResource(req, docId, 'annotations-read', pdfBits);
    return readAnnotations({
      documentService,
      pool,
      revisionBridge,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'base', ctx, docId },
      pageObjectNumber: parsePageObjectNumber(pon),
      requestedVersion: parseTokenOrInvalidArg(
        decodeAnnotationToken,
        token,
        'annotationVersion token',
      ),
    });
  });

  app.get('/v1/docs/:docId/pages/:pon/annotations', async (req, reply) => {
    const { docId, pon } = req.params as { docId: string; pon: string };
    const accessCtx = requireDocAccessOnly(req, docId);
    const pdfBits = await documentService.getEffectivePdfBits(accessCtx, docId);
    const ctx = requireResource(req, docId, 'annotations-read', pdfBits);
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

  app.get('/v1/docs/:docId/layers/:layerName/pages/:pon/annotations@:token', async (req, reply) => {
    const { docId, layerName, pon, token } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
      token: string;
    };
    const accessCtx = requireLayerDocAccessOnly(req, docId, layerName);
    const pdfBits = await documentService.getEffectivePdfBits(accessCtx, docId, layerName);
    const ctx = requireLayerResource(req, docId, layerName, 'annotations-read', pdfBits);
    return readAnnotations({
      documentService,
      pool,
      revisionBridge,
      reply,
      signal: abortSignalFromRequest(req),
      scope: { kind: 'layer', ctx, docId, layerName },
      pageObjectNumber: parsePageObjectNumber(pon),
      requestedVersion: parseTokenOrInvalidArg(
        decodeAnnotationToken,
        token,
        'annotationVersion token',
      ),
    });
  });

  app.get('/v1/docs/:docId/layers/:layerName/pages/:pon/annotations', async (req, reply) => {
    const { docId, layerName, pon } = req.params as {
      docId: string;
      layerName: string;
      pon: string;
    };
    const accessCtx = requireLayerDocAccessOnly(req, docId, layerName);
    const pdfBits = await documentService.getEffectivePdfBits(accessCtx, docId, layerName);
    const ctx = requireLayerResource(req, docId, layerName, 'annotations-read', pdfBits);
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
    const accessCtx = requireLayerDocAccessOnly(req, docId, layerName);
    const pdfBits = await documentService.getEffectivePdfBits(accessCtx, docId, layerName);
    const ctx = requireLayerCapability(req, docId, layerName, 'doc.annotate.modify', pdfBits);
    setNoStore(reply);
    const body = parseOrInvalidArg(
      WeakAnnotationSessionPagesRequestSchema,
      req.body,
      'request body',
    );
    return requireWeakAnnotationSessions(weakAnnotationSessions).begin(
      { tenantId: ctx.tenantId, sub: ctx.sub },
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
      const accessCtx = requireLayerDocAccessOnly(req, docId, layerName);
      const pdfBits = await documentService.getEffectivePdfBits(accessCtx, docId, layerName);
      const ctx = requireLayerCapability(req, docId, layerName, 'doc.annotate.modify', pdfBits);
      setNoStore(reply);
      const body = parseOrInvalidArg(
        WeakAnnotationSessionPagesRequestSchema,
        req.body,
        'request body',
      );
      return requireWeakAnnotationSessions(weakAnnotationSessions).updatePages(
        { tenantId: ctx.tenantId, sub: ctx.sub },
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
      const accessCtx = requireLayerDocAccessOnly(req, docId, layerName);
      const pdfBits = await documentService.getEffectivePdfBits(accessCtx, docId, layerName);
      const ctx = requireLayerCapability(req, docId, layerName, 'doc.annotate.modify', pdfBits);
      setNoStore(reply);
      return requireWeakAnnotationSessions(weakAnnotationSessions).heartbeat(
        { tenantId: ctx.tenantId, sub: ctx.sub },
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
      const accessCtx = requireLayerDocAccessOnly(req, docId, layerName);
      const pdfBits = await documentService.getEffectivePdfBits(accessCtx, docId, layerName);
      const ctx = requireLayerCapability(req, docId, layerName, 'doc.annotate.modify', pdfBits);
      await requireWeakAnnotationSessions(weakAnnotationSessions).release(
        { tenantId: ctx.tenantId, sub: ctx.sub },
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
    const accessCtx = requireLayerDocAccessOnly(req, docId, layerName);
    const pdfBits = await documentService.getEffectivePdfBits(accessCtx, docId, layerName);
    // Creation is a collab check against the caller's own identity
    // (no impersonation). `:self`/`:all` trivially pass; `:group=X`
    // constrains creators to those whose default group is X. Under
    // the narrowing model, `doc.annotate.modify` covers create when
    // no create-collab filter is present.
    const target = targetForSelfCreate(accessCtx.jwt);
    const ctx = requireLayerCollabAction(req, docId, layerName, 'create', target, pdfBits);
    const draft = parseOrInvalidArg<AnnotationDraft>(
      AnnotationDraftSchema as unknown as SchemaLike<AnnotationDraft>,
      req.body,
      'request body',
    );
    const actor = actorFromJwt(ctx.jwt);

    setNoStore(reply);
    return layerService.createAnnotation(
      ctx,
      { docId, layerName, pageObjectNumber, draft, actor },
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
    const accessCtx = requireLayerDocAccessOnly(req, docId, layerName);
    const pdfBits = await documentService.getEffectivePdfBits(accessCtx, docId, layerName);
    const ctx = requireLayerCapability(req, docId, layerName, 'doc.annotate.modify', pdfBits);
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
      ctx,
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
      const accessCtx = requireLayerDocAccessOnly(req, docId, layerName);
      const pdfBits = await documentService.getEffectivePdfBits(accessCtx, docId, layerName);
      const body = req.body as Record<string, unknown> | null | undefined;
      const signal = abortSignalFromRequest(req);

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
        const action = body?.op === 'delete' ? 'delete' : 'update';
        // Use the outer accessCtx (already JWT-verified, no capability
        // check) for the layer open the target lookup needs to perform.
        const target = await layerService.getAnnotationCollabTarget(
          accessCtx,
          docId,
          layerName,
          pageObjectNumber,
          ref,
          signal,
        );
        const ctx = requireLayerCollabAction(req, docId, layerName, action, target, pdfBits);
        if (action === 'delete') {
          setNoStore(reply);
          return layerService.deleteAnnotation(ctx, { docId, layerName, ref }, signal);
        }

        const patch = parseOrInvalidArg<AnnotationPatch>(
          AnnotationPatchSchema as unknown as SchemaLike<AnnotationPatch>,
          body?.patch,
          'body.patch',
        );
        const actor = buildUpdateActor(ctx.jwt, target, patch, pdfBits);
        setNoStore(reply);
        return layerService.updateAnnotation(ctx, { docId, layerName, ref, patch, actor }, signal);
      }

      const ref = refFromKey(annotKey, pageObjectNumber);
      const target = await layerService.getAnnotationCollabTarget(
        accessCtx,
        docId,
        layerName,
        pageObjectNumber,
        ref,
        signal,
      );
      const ctx = requireLayerCollabAction(req, docId, layerName, 'update', target, pdfBits);
      const patch = parseOrInvalidArg<AnnotationPatch>(
        AnnotationPatchSchema as unknown as SchemaLike<AnnotationPatch>,
        body?.patch,
        'body.patch',
      );
      const actor = buildUpdateActor(ctx.jwt, target, patch, pdfBits);
      setNoStore(reply);
      return layerService.updateAnnotation(ctx, { docId, layerName, ref, patch, actor }, signal);
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
      const accessCtx = requireLayerDocAccessOnly(req, docId, layerName);
      const pdfBits = await documentService.getEffectivePdfBits(accessCtx, docId, layerName);

      if (annotKey === 'index') {
        throw new EngineError(
          EngineErrorCode.InvalidArg,
          "cannot DELETE by index; use PATCH with { ref, op: 'delete' } so the revision token can be validated",
        );
      }

      const signal = abortSignalFromRequest(req);
      const ref = refFromKey(annotKey, pageObjectNumber);
      const target = await layerService.getAnnotationCollabTarget(
        accessCtx,
        docId,
        layerName,
        pageObjectNumber,
        ref,
        signal,
      );
      const ctx = requireLayerCollabAction(req, docId, layerName, 'delete', target, pdfBits);

      setNoStore(reply);
      return layerService.deleteAnnotation(
        ctx,
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

// ----------------------------------------------------------------------
// Annotation identity helpers
//
// Three small pure helpers, one per mutation shape:
//   - targetForSelfCreate: build the CollabTarget for create checks
//                          from JWT identity (no impersonation).
//   - actorFromJwt:        build the worker actor for create from JWT
//                          identity. The worker stamps /T,
//                          /EMBD_Metadata/UserID,CreatedBy,UpdatedBy,
//                          and /EMBD_Metadata/GroupID.
//   - buildUpdateActor:    build the update actor (modification trail
//                          + optional group reassignment gated by
//                          :set-group).
// ----------------------------------------------------------------------

/**
 * Build the CollabTarget for a create check. Targets the caller's own
 * identity — no impersonation, no draft-side override. `:self`/`:all`
 * pass trivially; `:group=X` is the meaningful filter (matches only
 * when the caller's default group is X).
 */
function targetForSelfCreate(jwt: RequestJwtContext): CollabTarget {
  const id = jwt.identity;
  return {
    ...(id.user_id !== undefined ? { userId: id.user_id } : {}),
    ...(id.group_id !== undefined ? { groupId: id.group_id } : {}),
  };
}

/**
 * Build the CREATE actor from the caller's JWT identity. The worker
 * writes:
 *
 *   /T                                         ← actor.displayName
 *   /EMBD_Metadata/UserID,CreatedBy,UpdatedBy  ← actor.userId
 *   /EMBD_Metadata/GroupID                     ← actor.groupId
 *
 * Returns `undefined` when the JWT carries no identity at all
 * (anonymous tenant tokens) — the worker still stamps /M but skips /T
 * and /EMBD_Metadata.
 */
function actorFromJwt(jwt: RequestJwtContext): AnnotationActor | undefined {
  const id = jwt.identity;
  const actor: AnnotationActor = {
    ...(id.user_id !== undefined ? { userId: id.user_id } : {}),
    ...(id.group_id !== undefined ? { groupId: id.group_id } : {}),
    ...(id.display_name !== undefined ? { displayName: id.display_name } : {}),
  };
  return actor.userId || actor.groupId || actor.displayName ? actor : undefined;
}

/**
 * Build the worker-side actor for UPDATE.
 *
 *   - `userId`      = caller's JWT user_id → stamped as
 *                     /EMBD_Metadata/UpdatedBy (modification trail).
 *   - `displayName` = caller's display_name → carried for the
 *                     modification trail. The worker does not touch /T
 *                     on update; /T is bound at creation.
 *   - `groupId`     = `patch.groupId` ONLY when it reassigns the row
 *                     (differs from current groupId) → stamped as the
 *                     new /EMBD_Metadata/GroupID. Absent means "don't
 *                     touch."
 *
 * Throws 403 if the patch is reassigning groupId and the caller lacks
 * `annotations:set-group` authority for the new group. UserID and
 * CreatedBy are bound at creation and cannot be patched.
 */
function buildUpdateActor(
  jwt: RequestJwtContext,
  currentTarget: CollabTarget,
  patch: AnnotationPatch,
  pdfBits: PdfBits,
): AnnotationActor | undefined {
  const patchedGroupId = (patch as { groupId?: string }).groupId;
  const isReassigningGroup =
    typeof patchedGroupId === 'string' && patchedGroupId !== currentTarget.groupId;

  if (isReassigningGroup) {
    if (!checkSetGroup(patchedGroupId, jwt.identity.group_id, jwt.scope, pdfBits)) {
      throw new EngineError(
        EngineErrorCode.Forbidden,
        `annotations:set-group denied for group=${patchedGroupId}`,
      );
    }
  }

  const actor: AnnotationActor = {
    ...(jwt.identity.user_id !== undefined ? { userId: jwt.identity.user_id } : {}),
    ...(jwt.identity.display_name !== undefined ? { displayName: jwt.identity.display_name } : {}),
    ...(isReassigningGroup ? { groupId: patchedGroupId } : {}),
  };
  return actor.userId || actor.groupId || actor.displayName ? actor : undefined;
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
  if (
    input.requestedVersion !== undefined &&
    input.requestedVersion !== page.cache.annotationVersion
  ) {
    setNoStore(input.reply);
    throw new EngineError(
      EngineErrorCode.NotFound,
      `${input.scope.kind === 'layer' ? 'layer ' : ''}annotation version ${
        input.requestedVersion
      } no longer current (current=${page.cache.annotationVersion}) for page ${
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
