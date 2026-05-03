import type { FastifyInstance, FastifyRequest } from 'fastify';
import { JwtVerifier, type JwtClaims } from '../auth/JwtVerifier';

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: { id: string; sub: string; claims: JwtClaims };
  }
}

export interface JwtPluginOptions {
  secret: string;
  /** Routes that should bypass authentication (e.g. health checks). */
  publicPaths?: ReadonlyArray<string>;
}

/**
 * preHandler-style auth: extracts Bearer token, verifies HS256, attaches a
 * tenant context to the request. Routes use `requireTenant(req)` to read it.
 */
export async function registerJwtAuth(app: FastifyInstance, opts: JwtPluginOptions): Promise<void> {
  const verifier = new JwtVerifier({ secret: opts.secret });
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
      const claims = verifier.verify(token);
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
