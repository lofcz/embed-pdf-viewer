import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  createJwtVerifier,
  hasAdminScope,
  type AdminScope,
  type JwtClaims,
  type JwtVerifier,
  type JwtVerifierConfig,
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
 * Admin-route preHandler: asserts the request carries an admin-class
 * token with at least one of `wanted` scopes. Throws a typed error
 * (`AdminForbidden`) which the error handler maps to 403.
 */
export function requireAdmin(
  req: FastifyRequest,
  wanted: ReadonlyArray<AdminScope>,
): { tenantId: string; sub: string } {
  const t = req.tenant;
  if (!t) {
    const err = new Error('admin token required') as Error & { code: string; status: number };
    err.code = 'AdminUnauthenticated';
    err.status = 401;
    throw err;
  }
  if (!hasAdminScope(t.claims, wanted)) {
    const err = new Error(`admin scope required: one of [${wanted.join(', ')}]`) as Error & {
      code: string;
      status: number;
    };
    err.code = 'AdminForbidden';
    err.status = 403;
    throw err;
  }
  return { tenantId: t.id, sub: t.sub };
}
