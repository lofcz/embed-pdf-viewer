import type { FastifyInstance } from 'fastify';
import {
  EngineError,
  EngineErrorCode,
  permissionInfoFromProbe,
  type DocumentAccessInfo,
} from '@embedpdf/engine-core/runtime';
import { AccessRequestSchema, wirePaths } from '@embedpdf/engine-core/wire';
import { requireLayerDocAccess, type RequestJwtContext } from '../app/jwt-plugin';
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
    const ctx = requireLayerDocAccess(req, body.docId, layerName, ['doc.read']);
    const unlocked = await service.unlockLayerAccess(ctx, body.docId, layerName, {
      password: body.password ?? null,
      passwordGrant: body.passwordGrant ?? null,
      mode: body.mode ?? 'any',
    });
    const access = buildNoneAccess(unlocked, ctx.jwt);
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
): DocumentAccessInfo {
  if (!jwt.exp || jwt.exp <= 0) {
    throw new EngineError(EngineErrorCode.InvalidArg, 'doc token exp is required for access');
  }
  const expiresAt = jwt.exp;
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
    pdfPermissions: permissionInfoFromProbe(unlocked.probe),
    scope: [...jwt.scope],
    identity: {
      ...jwt.identity,
      ...(jwt.identity.groups ? { groups: [...jwt.identity.groups] } : {}),
    },
    originPasswordPolicy: {
      mode: unlocked.probe.encryptionState === 'encrypted' ? 'server-session' : 'not-needed',
    },
    expiresAt,
  };
}
