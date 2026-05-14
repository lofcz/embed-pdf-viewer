/**
 * Security tests for token-class discipline.
 *
 * Tokens are exactly one of TenantClaims / DocUserClaims, discriminated
 * by the presence of `doc_id`. Both classes carry a `scope` field, in
 * different namespaces (TenantScope vs DocScope) — route guards enforce
 * the value-set matches the audience they serve.
 *
 *   - Layer 0 (`signDevToken`): rejects layer_name without doc_id.
 *   - Layer 2 (`coerceClaims`): rejects malformed payloads (non-array
 *     scope, empty/missing tenant_id, layer_name w/o doc_id).
 *   - Layer 3 (route guards): `requireScope` rejects doc tokens hitting
 *     tenant routes; `requireDocAccess` rejects mismatched doc_id and
 *     enforces tenant fallback only with docs.read scope.
 *
 * Failing any of these is a P0 security regression.
 */
import { describe, expect, test } from 'vitest';
import type { FastifyRequest } from 'fastify';
import {
  Hs256Verifier,
  isDocUserClaims,
  isTenantClaims,
  signDevToken,
  type JwtClaims,
} from '../src/auth/JwtVerifier';
import { requireDocAccess, requireScope } from '../src/app/jwt-plugin';

const SECRET = 'test-secret-class-discipline';

function fakeReq(claims: JwtClaims): FastifyRequest {
  return {
    tenant: { id: claims.tenant_id, sub: claims.sub, claims },
  } as unknown as FastifyRequest;
}

async function verify(token: string): Promise<JwtClaims> {
  return new Hs256Verifier({ secret: SECRET }).verify(token);
}

describe('signDevToken — Layer 0 (mint time)', () => {
  test('rejects layer_name without doc_id', () => {
    expect(() =>
      signDevToken(SECRET, {
        sub: 'u',
        tenant_id: 't',
        layer_name: 'orphan',
      }),
    ).toThrow(/layer_name requires doc_id/);
  });

  test('mints a tenant token with scope', () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      scope: ['docs.create'],
    });
    expect(tok.split('.')).toHaveLength(3);
  });

  test('mints a doc token (with optional scope + layer_name)', () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      doc_id: 'doc-1',
      scope: ['doc.read', 'doc.annotate'],
      layer_name: 'default',
    });
    expect(tok.split('.')).toHaveLength(3);
  });
});

describe('coerceClaims — Layer 2 (verifier)', () => {
  test('rejects scope that is not an array', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      extras: { scope: 'not-an-array' },
    });
    await expect(verify(tok)).rejects.toThrow(/scope must be an array/);
  });

  test('rejects scope containing non-strings', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      extras: { scope: [42 as unknown as string] },
    });
    await expect(verify(tok)).rejects.toThrow(/scope must contain strings/);
  });

  test('tenant token gets the TenantClaims discriminator', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      scope: ['*'],
    });
    const claims = await verify(tok);
    expect(isTenantClaims(claims)).toBe(true);
    expect(isDocUserClaims(claims)).toBe(false);
  });

  test('doc-user token gets the DocUserClaims discriminator', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      doc_id: 'doc-1',
      scope: ['doc.read'],
    });
    const claims = await verify(tok);
    expect(isDocUserClaims(claims)).toBe(true);
    expect(isTenantClaims(claims)).toBe(false);
  });

  test('a token with both scope and doc_id is tagged as DocUserClaims (scope is doc-scoped)', async () => {
    // No longer a "hybrid" — both classes carry scope. The class is
    // committed by `doc_id`; the scope array is interpreted under
    // DocScope. A nonsensical value like `docs.create` on a doc
    // token survives parsing but no route guard ever honours it.
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      doc_id: 'doc-1',
      extras: { scope: ['docs.create'] },
    });
    const claims = await verify(tok);
    expect(isDocUserClaims(claims)).toBe(true);
    expect(claims.scope).toEqual(['docs.create']);
  });

  test('rejects layer_name without doc_id (smuggling via extras)', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      extras: { layer_name: 'orphan' },
    });
    await expect(verify(tok)).rejects.toThrow(/layer_name requires doc_id/);
  });
});

describe('requireScope — Layer 3 (tenant route guard)', () => {
  test('accepts a tenant token with the requested scope', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      scope: ['docs.create'],
    });
    const claims = await verify(tok);
    const ctx = requireScope(fakeReq(claims), ['docs.create']);
    expect(ctx.tenantId).toBe('t');
  });

  test('accepts a wildcard tenant token for any scope', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      scope: ['*'],
    });
    const claims = await verify(tok);
    expect(requireScope(fakeReq(claims), ['docs.delete']).tenantId).toBe('t');
    expect(requireScope(fakeReq(claims), ['tokens.mint']).tenantId).toBe('t');
  });

  test('rejects a doc-scoped token reaching a tenant route', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      doc_id: 'doc-1',
      scope: ['*'],
    });
    const claims = await verify(tok);
    expect(() => requireScope(fakeReq(claims), ['docs.create'])).toThrow(
      /doc-scoped token cannot access tenant/,
    );
  });

  test('rejects a tenant token with empty scope', async () => {
    const tok = signDevToken(SECRET, { sub: 'u', tenant_id: 't', scope: [] });
    const claims = await verify(tok);
    expect(() => requireScope(fakeReq(claims), ['docs.create'])).toThrow(/tenant scope required/);
  });

  test('rejects a tenant token with no scope claim at all', async () => {
    const tok = signDevToken(SECRET, { sub: 'u', tenant_id: 't' });
    const claims = await verify(tok);
    expect(() => requireScope(fakeReq(claims), ['docs.create'])).toThrow(/tenant scope required/);
  });

  test('rejects a tenant token missing the wanted scope', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      scope: ['docs.read'],
    });
    const claims = await verify(tok);
    expect(() => requireScope(fakeReq(claims), ['docs.delete'])).toThrow(/tenant scope required/);
  });
});

describe('requireDocAccess — Layer 3 (doc route guard)', () => {
  test('accepts a doc token whose doc_id matches and carries doc.read', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      doc_id: 'doc-1',
      scope: ['doc.read'],
    });
    const claims = await verify(tok);
    const ctx = requireDocAccess(fakeReq(claims), 'doc-1', ['doc.read']);
    expect(ctx.tenantId).toBe('t');
    expect(ctx.mode).toBe('doc');
  });

  test('rejects when doc_id mismatches the URL', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      doc_id: 'doc-1',
      scope: ['*'],
    });
    const claims = await verify(tok);
    expect(() => requireDocAccess(fakeReq(claims), 'doc-2', ['doc.read'])).toThrow(
      /different document/,
    );
  });

  test('rejects a doc token missing the needed DocScope', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      doc_id: 'doc-1',
      scope: ['doc.read'],
    });
    const claims = await verify(tok);
    expect(() => requireDocAccess(fakeReq(claims), 'doc-1', ['doc.annotate'])).toThrow(
      /doc scope required/,
    );
  });

  test('accepts a doc token with the * doc-scope for any need', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      doc_id: 'doc-1',
      scope: ['*'],
    });
    const claims = await verify(tok);
    expect(requireDocAccess(fakeReq(claims), 'doc-1', ['doc.annotate']).mode).toBe('doc');
  });

  test('accepts a tenant token with docs.read on any doc (Model B)', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      scope: ['docs.read'],
    });
    const claims = await verify(tok);
    const ctx = requireDocAccess(fakeReq(claims), 'any-doc', ['doc.read']);
    expect(ctx.tenantId).toBe('t');
    expect(ctx.mode).toBe('tenant');
  });

  test('accepts a tenant token with * on any doc, regardless of DocScope', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      scope: ['*'],
    });
    const claims = await verify(tok);
    expect(requireDocAccess(fakeReq(claims), 'doc-x', ['doc.annotate']).mode).toBe('tenant');
  });

  test('rejects a tenant token without docs.read or *', async () => {
    const tok = signDevToken(SECRET, {
      sub: 'u',
      tenant_id: 't',
      scope: ['tokens.mint'],
    });
    const claims = await verify(tok);
    expect(() => requireDocAccess(fakeReq(claims), 'doc-1', ['doc.read'])).toThrow(
      /tenant scope required/,
    );
  });

  test('rejects an empty-scope tenant token', async () => {
    const tok = signDevToken(SECRET, { sub: 'u', tenant_id: 't' });
    const claims = await verify(tok);
    expect(() => requireDocAccess(fakeReq(claims), 'doc-1', ['doc.read'])).toThrow(
      /tenant scope required/,
    );
  });
});
