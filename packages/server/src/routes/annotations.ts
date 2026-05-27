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
    const draft = parseOrInvalidArg<AnnotationDraft>(
      AnnotationDraftSchema as unknown as SchemaLike<AnnotationDraft>,
      req.body,
      'request body',
    );

    // 1. Resolve the effective target (draft.userId/groupId override the
    //    caller's JWT identity for impersonation / cross-group authoring).
    const target = effectiveTargetForCreate(accessCtx.jwt, draft);

    // 2. Collab check evaluated against the effective target.
    const ctx = requireLayerCollabAction(req, docId, layerName, 'create', target, pdfBits);

    // 3. Set-group check — only fires for cross-group authoring.
    assertSetGroupAllowed(target.groupId, accessCtx.jwt.identity.group_id, ctx.jwt.scope, pdfBits);

    // 4. Worker stamps the effective identity onto /EMBD_Metadata.
    const actor = buildCreateActor(accessCtx.jwt, target);

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
// Three pure helpers that compose into the create/update flow:
//   - effectiveTargetForCreate: merges draft overrides with JWT defaults
//   - assertSetGroupAllowed:    runs the set-group authority check
//   - buildCreateActor/UpdateActor: build the actor the worker stamps
//
// Keeping them in the route file lets the handlers read top-down as a
// short numbered sequence instead of a wall of inline type-guard code.
// ----------------------------------------------------------------------

/**
 * Merge `draft.userId` / `draft.groupId` overrides with the caller's
 * JWT-default identity. Overrides win; absent fields fall back to JWT.
 * Used as both the collab-check target AND the worker-stamp identity.
 *
 * Producing an empty object is legitimate — anonymous fixtures with no
 * `user_id` / `group_id` claims and no draft overrides have nothing to
 * target. The collab resolver treats it as "not self / not in any
 * group," which denies `:self` / `:group=X` and allows `:all`.
 */
function effectiveTargetForCreate(jwt: RequestJwtContext, draft: AnnotationDraft): CollabTarget {
  const userId = draft.userId ?? jwt.identity.user_id;
  const groupId = draft.groupId ?? jwt.identity.group_id;
  return {
    ...(userId !== undefined ? { userId } : {}),
    ...(groupId !== undefined ? { groupId } : {}),
  };
}

/**
 * Run the set-group authority check, throwing 403 on deny. No-op when
 * the effective groupId equals the caller's default (no reassignment
 * is happening) or when no group is being assigned at all.
 */
function assertSetGroupAllowed(
  effectiveGroupId: string | undefined,
  callerDefaultGroupId: string | undefined,
  scope: ReadonlyArray<string>,
  pdfBits: PdfBits,
): void {
  if (effectiveGroupId === undefined) return;
  if (!checkSetGroup(effectiveGroupId, callerDefaultGroupId, scope, pdfBits)) {
    throw new EngineError(
      EngineErrorCode.Forbidden,
      `annotations:set-group denied for group=${effectiveGroupId}`,
    );
  }
}

/**
 * Build the worker-side actor for CREATE. The worker stamps these
 * fields into /EMBD_Metadata (UserID, GroupID, CreatedBy, UpdatedBy)
 * and /T (displayName). Returns `undefined` when nothing meaningful is
 * stamped; the worker treats absent actor as "no EMBD_Metadata" but
 * always still stamps /M from the base writer.
 */
function buildCreateActor(
  jwt: RequestJwtContext,
  effective: CollabTarget,
): AnnotationActor | undefined {
  const actor: AnnotationActor = {
    ...(effective.userId !== undefined ? { userId: effective.userId } : {}),
    ...(effective.groupId !== undefined ? { groupId: effective.groupId } : {}),
    ...(jwt.identity.display_name !== undefined ? { displayName: jwt.identity.display_name } : {}),
  };
  return actor.userId || actor.groupId || actor.displayName ? actor : undefined;
}

/**
 * Build the worker-side actor for UPDATE.
 *
 *   - `userId`      = caller's JWT user_id → stamped as /EMBD_Metadata/UpdatedBy
 *   - `displayName` = caller's display_name → stamped as /T
 *   - `groupId`     = `patch.groupId` ONLY when it reassigns the row
 *                     (differs from current groupId) → stamped as the new
 *                     /EMBD_Metadata/GroupID. Absent means "don't touch."
 *
 * Throws 403 if the patch is trying to reassign groupId and the caller
 * lacks `annotations:set-group` authority for the new group. userId is
 * never taken from the patch — UserID/CreatedBy are immutable per
 * AnnotationPatchBase semantics.
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
    assertSetGroupAllowed(patchedGroupId, jwt.identity.group_id, jwt.scope, pdfBits);
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
