import type { FastifyInstance } from 'fastify';
import {
  EngineError,
  EngineErrorCode,
  permissionInfoFromProbe,
  type DocumentAccessInfo,
} from '@embedpdf/engine-core/runtime';
import { AccessRequestSchema, wirePaths } from '@embedpdf/engine-core/wire';
import { requireLayerDocAccess } from '../app/jwt-plugin';
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
      mode: body.mode ?? 'any',
    });
    const access = buildNoneAccess(unlocked, req.tenant?.claims);
    setNoStore(reply);
    return {
      security: unlocked.security,
      ...access,
    };
  });
}

function buildNoneAccess(
  unlocked: Awaited<ReturnType<DocumentService['unlockLayerAccess']>>,
  claims: unknown,
): DocumentAccessInfo {
  const exp = claimNumber(claims, 'exp');
  const expiresAt = exp && exp > 0 ? exp : Math.floor(Date.now() / 1000) + 3600;
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
    passwordGrant: null,
    pdfPermissions: permissionInfoFromProbe(unlocked.probe),
    scope: claimStringArray(claims, 'scope'),
    identity: {
      ...claimString(claims, 'user_id', 'user_id'),
      ...claimString(claims, 'group_id', 'group_id'),
      ...claimString(claims, 'display_name', 'display_name'),
      ...claimStringArrayProp(claims, 'groups', 'groups'),
    },
    originPasswordPolicy: {
      mode: unlocked.probe.encryptionState === 'encrypted' ? 'client-retry' : 'not-needed',
    },
    expiresAt,
  };
}

function claimNumber(claims: unknown, key: string): number | null {
  if (!claims || typeof claims !== 'object') return null;
  const value = (claims as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : null;
}

function claimStringArray(claims: unknown, key: string): string[] {
  if (!claims || typeof claims !== 'object') return [];
  const value = (claims as Record<string, unknown>)[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function claimString<T extends string>(
  claims: unknown,
  key: string,
  outKey: T,
): Partial<Record<T, string>> {
  if (!claims || typeof claims !== 'object') return {};
  const value = (claims as Record<string, unknown>)[key];
  return typeof value === 'string' ? ({ [outKey]: value } as Partial<Record<T, string>>) : {};
}

function claimStringArrayProp<T extends string>(
  claims: unknown,
  key: string,
  outKey: T,
): Partial<Record<T, string[]>> {
  const value = claimStringArray(claims, key);
  return value.length > 0 ? ({ [outKey]: value } as Partial<Record<T, string[]>>) : {};
}
