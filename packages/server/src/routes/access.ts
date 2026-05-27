import type { FastifyInstance } from 'fastify';
import {
  EngineError,
  EngineErrorCode,
  decodePdfBits,
  expandRawScope,
  permissionInfoWithAdvisory,
  type DocumentAccessInfo,
  type PdfBits,
} from '@embedpdf/engine-core/runtime';
import { AccessRequestSchema, wirePaths } from '@embedpdf/engine-core/wire';
import { requireLayerDocAccessOnly, type RequestJwtContext } from '../app/jwt-plugin';
import type { DocumentService } from '../services/DocumentService';
import { setNoStore } from './_helpers';

export interface AccessRouteDeps {
  service: DocumentService;
}

export async function registerAccessRoutes(
  app: FastifyInstance,
  deps: AccessRouteDeps,
): Promise<void> {
  const { service } = deps;

  app.post(wirePaths.access, async (req, reply) => {
    const parsed = AccessRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new EngineError(
        EngineErrorCode.InvalidArg,
        `invalid access request: ${parsed.error.message}`,
      );
    }
    const body = parsed.data;
    const layerName = body.layerName ?? 'default';
    const ctx = requireLayerDocAccessOnly(req, body.docId, layerName);
    const unlocked = await service.unlockLayerAccess(ctx, body.docId, layerName, {
      password: body.password ?? null,
      passwordGrant: body.passwordGrant ?? null,
      mode: body.mode ?? 'any',
    });
    // Effective bits for this response come from the unlock probe — NOT
    // from the DB row. The row was populated by an anonymous probe at
    // ingest and is stale for encrypted documents; the just-completed
    // unlock is the authoritative source for "what bits does this
    // caller see right now." Driving both `pdfPermissions` and the
    // `effectiveScope` expansion from the same source keeps the
    // response internally consistent (this resolves the bug where
    // post-unlock bits and pre-unlock flags disagreed).
    const pdfBits = decodePdfBits(unlocked.probe.pdfPermissionsBits);
    const access = buildNoneAccess(unlocked, ctx.jwt, pdfBits);
    setNoStore(reply);
    return {
      security: unlocked.security,
      ...access,
    };
  });
}

function buildNoneAccess(
  unlocked: Awaited<ReturnType<DocumentService['unlockLayerAccess']>>,
  jwt: RequestJwtContext,
  pdfBits: PdfBits,
): DocumentAccessInfo {
  if (!jwt.exp || jwt.exp <= 0) {
    throw new EngineError(EngineErrorCode.InvalidArg, 'doc token exp is required for access');
  }
  const expiresAt = jwt.exp;

  // Expand the raw JWT scope into a concrete capability set. This is
  // what the client should drive UI off — `pdf.permissions` is opaque
  // until expanded against the document's PDF bits, and the resolver
  // also applies implication rules (e.g. annotations collab scopes
  // imply doc.annotate.read).
  const effectiveScope = [...expandRawScope(jwt.scope, pdfBits)].sort();

  return {
    cdn: {
      adapter: 'none',
      expiresAt,
      cache: {
        scope: 'browser-private',
        immutableVersionedReads: true,
      },
      baseUrlOverrides: null,
      authHeader: null,
    },
    passwordGrant: unlocked.passwordGrant,
    // Enriched permission info: includes flags (typed bit view) and
    // advisory (capability-shaped booleans for UI badges) on top of
    // the raw bits/openedAs already in PdfPermissionInfo.
    pdfPermissions: permissionInfoWithAdvisory(unlocked.probe, pdfBits),
    scope: [...jwt.scope],
    effectiveScope,
    // Explicit identity construction (rather than spreading
    // jwt.identity) so the readonly `groups` array doesn't leak into a
    // mutable-typed slot. Each field is copied only when present.
    identity: identityForResponse(jwt),
    originPasswordPolicy: {
      mode: unlocked.probe.encryptionState === 'encrypted' ? 'server-session' : 'not-needed',
    },
    expiresAt,
  };
}

function identityForResponse(jwt: RequestJwtContext): DocumentAccessInfo['identity'] {
  const id = jwt.identity;
  return {
    ...(id.user_id !== undefined ? { user_id: id.user_id } : {}),
    ...(id.group_id !== undefined ? { group_id: id.group_id } : {}),
    ...(id.display_name !== undefined ? { display_name: id.display_name } : {}),
    ...(id.groups !== undefined ? { groups: [...id.groups] } : {}),
  };
}
