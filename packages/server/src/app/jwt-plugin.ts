import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  createJwtVerifier,
  hasDocScope,
  hasTenantScope,
  isDocUserClaims,
  isTenantClaims,
  type DocScope,
  type JwtClaims,
  type JwtVerifier,
  type JwtVerifierConfig,
  type TenantScope,
} from '../auth/JwtVerifier';

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: { id: string; sub: string; claims: JwtClaims };
  }
}

export interface JwtPluginOptions {
  /**
   * Verifier config. Pass `{ mode: 'hs256', secret }` for dev/test
   * (HS256 shared secret) or one of `asymmetric` / `jwks` for prod.
   *
   * Backward compat: passing a bare `{ secret }` is treated as HS256.
   */
  verifier: JwtVerifierConfig | { secret: string };
  /** Routes that should bypass authentication (e.g. health checks). */
  publicPaths?: ReadonlyArray<string>;
}

function asConfig(input: JwtPluginOptions['verifier']): JwtVerifierConfig {
  if ('mode' in input) return input;
  return { mode: 'hs256', secret: input.secret };
}

/**
 * preHandler-style auth: extracts Bearer token, verifies via the
 * configured `JwtVerifier`, attaches a tenant context to the
 * request. Routes use `requireTenant(req)` to read it.
 */
export async function registerJwtAuth(app: FastifyInstance, opts: JwtPluginOptions): Promise<void> {
  const verifier: JwtVerifier = createJwtVerifier(asConfig(opts.verifier));
  const publics = new Set(opts.publicPaths ?? []);

  app.addHook('onRequest', async (req, reply) => {
    if (publics.has(req.url)) return;
    if (req.url === '/healthz' || req.url === '/readyz') return;

    const auth = req.headers['authorization'];
    if (!auth || typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'missing bearer token' });
      return;
    }
    const token = auth.slice('Bearer '.length).trim();
    try {
      const claims = await verifier.verify(token);
      req.tenant = { id: claims.tenant_id, sub: claims.sub, claims };
    } catch (err) {
      reply.code(401).send({ error: `invalid token: ${(err as Error).message}` });
      return;
    }
  });
}

export function requireTenant(req: FastifyRequest): string {
  const t = req.tenant;
  if (!t) throw new Error('tenant not attached to request (auth bypass?)');
  return t.id;
}

/**
 * Tenant-route preHandler: asserts the request carries a tenant
 * token holding at least one of `wanted` scopes (or `*`). Throws a
 * typed error (`Forbidden`) the error handler maps to 403.
 *
 * Doc-scoped tokens are rejected — they live in a different scope
 * namespace and have no business reaching tenant-wide operations.
 */
export function requireScope(
  req: FastifyRequest,
  wanted: ReadonlyArray<TenantScope>,
): { tenantId: string; sub: string } {
  const t = req.tenant;
  if (!t) {
    const err = new Error('tenant token required') as Error & { code: string; status: number };
    err.code = 'Unauthenticated';
    err.status = 401;
    throw err;
  }
  if (isDocUserClaims(t.claims)) {
    const err = new Error('doc-scoped token cannot access tenant routes') as Error & {
      code: string;
      status: number;
    };
    err.code = 'Forbidden';
    err.status = 403;
    throw err;
  }
  if (!isTenantClaims(t.claims) || !hasTenantScope(t.claims, wanted)) {
    const err = new Error(`tenant scope required: one of [${wanted.join(', ')}]`) as Error & {
      code: string;
      status: number;
    };
    err.code = 'Forbidden';
    err.status = 403;
    throw err;
  }
  return { tenantId: t.id, sub: t.sub };
}

export type DocAccessMode = 'doc' | 'tenant';

/**
 * Doc-route preHandler: asserts the request carries a token
 * authorised to perform at least one of `needed` doc-scopes on the
 * URL's `docId`. Two legal paths:
 *
 *   1. **Doc-scoped token**: `doc_id` claim matches the URL, AND
 *      the token's `DocScope[]` contains one of `needed` (or `*`).
 *   2. **Tenant token**: `scope` contains `docs.read` (or `*`).
 *      The doc-tenant binding is enforced one layer down by
 *      `DocumentsRepo.requireOwned(docId, tenantId)` — the service
 *      layer refuses to load a doc that doesn't belong to the
 *      token's tenant.
 *
 * Returns the resolved tenant context plus a `mode` flag for audit
 * logging (so we can see whether a request reached a doc via the
 * tight doc-scope path or the wider tenant-scope path).
 */
export function requireDocAccess(
  req: FastifyRequest,
  docId: string,
  needed: ReadonlyArray<DocScope>,
): { tenantId: string; sub: string; mode: DocAccessMode } {
  const t = req.tenant;
  if (!t) {
    const err = new Error('doc-access token required') as Error & { code: string; status: number };
    err.code = 'Unauthenticated';
    err.status = 401;
    throw err;
  }

  if (isDocUserClaims(t.claims)) {
    if (t.claims.doc_id !== docId) {
      const err = new Error('token grants access to a different document') as Error & {
        code: string;
        status: number;
      };
      err.code = 'Forbidden';
      err.status = 403;
      throw err;
    }
    if (!hasDocScope(t.claims, needed)) {
      const err = new Error(`doc scope required: one of [${needed.join(', ')}]`) as Error & {
        code: string;
        status: number;
      };
      err.code = 'Forbidden';
      err.status = 403;
      throw err;
    }
    return { tenantId: t.id, sub: t.sub, mode: 'doc' };
  }

  // TenantClaims path. The tenant owns every doc in their tenant
  // and the service-layer requireOwned enforces the doc-tenant
  // match, so we only need to know the bearer is authorised for
  // tenant-level doc reads.
  if (!hasTenantScope(t.claims, ['*', 'docs.read'])) {
    const err = new Error('tenant scope required: one of [*, docs.read]') as Error & {
      code: string;
      status: number;
    };
    err.code = 'Forbidden';
    err.status = 403;
    throw err;
  }
  return { tenantId: t.id, sub: t.sub, mode: 'tenant' };
}

export function requireLayerDocAccess(
  req: FastifyRequest,
  docId: string,
  layerName: string,
  needed: ReadonlyArray<DocScope>,
): { tenantId: string; sub: string; mode: DocAccessMode } {
  const ctx = requireDocAccess(req, docId, needed);
  const claims = req.tenant?.claims;
  if (claims && isDocUserClaims(claims)) {
    const expected = claims.layer_name ?? 'default';
    if (expected !== layerName) {
      const err = new Error('token grants access to a different layer') as Error & {
        code: string;
        status: number;
      };
      err.code = 'Forbidden';
      err.status = 403;
      throw err;
    }
  }
  return ctx;
}
