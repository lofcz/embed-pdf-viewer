import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  importSPKI,
  jwtVerify,
  type JWK,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

// jose@5+ removed the public `KeyLike` alias. The verifier holds a
// reference to whatever `importSPKI` returns (a `CryptoKey` /
// `KeyObject`); derive the type structurally so we don't depend on a
// private export name that may change between minor versions.
type ImportedKey = Awaited<ReturnType<typeof importSPKI>>;

export interface JwtClaims {
  sub: string;
  tenant_id: string;
  iat: number;
  exp: number;
  /**
   * Optional admin scopes. Presence + non-empty array marks this as
   * an admin-class token usable on `/v1/admin/...` routes. Empty or
   * missing => engine-only token.
   */
  admin_scope?: ReadonlyArray<AdminScope>;
  /**
   * Optional opaque token id. Required for revocation; verifiers
   * configured with a `RevokedJtisGuard` reject any token whose
   * `jti` is in the denylist.
   */
  jti?: string;
}

export type AdminScope = '*' | 'docs.create' | 'docs.read' | 'docs.delete' | 'tokens.mint';

export type JwtClaimsExtras = Record<string, unknown>;

/**
 * Optional revocation hook: the verifier asks `isRevoked(jti)` after
 * signature verification. Returning `true` causes the verifier to
 * throw — the JWT plugin then turns that into a 401.
 *
 * The guard is intentionally async: production impls back the LRU
 * with a DB query. Tests pass a sync wrapper.
 */
export interface RevocationCheck {
  isRevoked(jti: string): Promise<boolean>;
}

/**
 * Per-issuer/audience validation profile. Applied by every verifier
 * implementation, regardless of mode. Mirrors `jose.JWTVerifyOptions`
 * but stripped to the subset we always set.
 */
export interface JwtAudienceProfile {
  /** Required `iss` claim value(s). */
  issuer?: string | ReadonlyArray<string>;
  /** Required `aud` claim value(s). */
  audience?: string | ReadonlyArray<string>;
  /** `exp` clock skew tolerance in seconds. Defaults to 30. */
  clockSkewSeconds?: number;
}

/**
 * Mode-specific configuration.
 *
 * - `hs256`: Shared-secret JWT. Existing dev/test path.
 * - `asymmetric`: RS256 / RS384 / RS512 / ES256 / ES384 / ES512 with a
 *   single PEM public key. Configured for `single-tenant` deploys.
 * - `jwks`: Multi-tenant SaaS — keys fetched from `jwksUri`, cached.
 *   The `cacheStore` adapter persists JWKS across restarts.
 *
 * The factory `createJwtVerifier(config)` picks the right impl.
 */
export type JwtVerifierConfig =
  | (JwtAudienceProfile & {
      mode: 'hs256';
      secret: string;
      revocation?: RevocationCheck;
    })
  | (JwtAudienceProfile & {
      mode: 'asymmetric';
      /** PEM SPKI public key (the `-----BEGIN PUBLIC KEY-----` block). */
      publicKeyPem: string;
      /** Algorithm to enforce; must match the key type. */
      algorithm: 'RS256' | 'RS384' | 'RS512' | 'ES256' | 'ES384' | 'ES512';
      revocation?: RevocationCheck;
    })
  | (JwtAudienceProfile & {
      mode: 'jwks';
      jwksUri: string;
      /** Algorithms accepted from the issuer. Empty => accept any RS/ES. */
      algorithms?: ReadonlyArray<string>;
      /** Persistent JWKS cache adapter. Optional. */
      cacheStore?: JwksCacheStore;
      /** TTL for the in-memory + persistent cache. Defaults to 10 min. */
      cacheTtlMs?: number;
      revocation?: RevocationCheck;
    });

/**
 * Persistent JWKS cache. Backed by the `jwks_cache` table; injected
 * by the JWT plugin so the verifier stays DB-agnostic at the type
 * level.
 */
export interface JwksCacheStore {
  get(issuer: string): Promise<{ jwks: { keys: JWK[] }; expiresAt: number } | null>;
  set(issuer: string, jwks: { keys: JWK[] }, ttlMs: number): Promise<void>;
}

/**
 * Common verifier interface. All modes return a fully-validated
 * `JwtClaims`; the caller can then attach to the request context.
 */
export interface JwtVerifier {
  verify(token: string): Promise<JwtClaims>;
}

/** Algorithms a `jwks` verifier accepts when `algorithms` is omitted. */
const DEFAULT_JWKS_ALGS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'] as const;

/**
 * Factory: returns the right `JwtVerifier` impl for the supplied
 * config. The JWT plugin only ever calls this — individual classes
 * are exported for tests and for advanced wiring.
 */
export function createJwtVerifier(config: JwtVerifierConfig): JwtVerifier {
  switch (config.mode) {
    case 'hs256':
      return new Hs256Verifier(config);
    case 'asymmetric':
      return new AsymmetricVerifier(config);
    case 'jwks':
      return new JwksVerifier(config);
  }
}

// ----------------- impls -----------------

const HEADER_HS256 = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

/**
 * Lightweight HS256 verifier — kept as a hand-rolled impl rather than
 * delegating to jose, because tests sign tokens with this same module
 * (no Web Crypto SubtleCrypto dance on every test). Behaviourally
 * identical to jose for the HS256 subset we use.
 */
export class Hs256Verifier implements JwtVerifier {
  private readonly secret: string;
  private readonly skew: number;
  private readonly profile: JwtAudienceProfile;
  private readonly revocation: RevocationCheck | undefined;

  constructor(opts: { secret: string; revocation?: RevocationCheck } & JwtAudienceProfile) {
    this.secret = opts.secret;
    this.skew = opts.clockSkewSeconds ?? 30;
    this.profile = opts;
    this.revocation = opts.revocation;
  }

  async verify(token: string): Promise<JwtClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('malformed jwt');
    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

    const expected = signHmac(this.secret, `${headerB64}.${payloadB64}`);
    const got = Buffer.from(sigB64, 'base64url');
    const want = Buffer.from(expected, 'base64url');
    if (got.length !== want.length || !timingSafeEqual(got, want)) {
      throw new Error('invalid jwt signature');
    }
    const claims = decodeClaims(payloadB64);
    validateClaims(claims, this.profile, this.skew);
    await checkRevocation(claims, this.revocation);
    return claims;
  }
}

/**
 * RS256/ES256-style verifier with a single static public key. Lower
 * operational complexity than JWKS; right call when the customer has
 * one stable signing key and rotates manually.
 */
export class AsymmetricVerifier implements JwtVerifier {
  private readonly keyPromise: Promise<ImportedKey>;
  private readonly algorithm: string;
  private readonly profile: JwtAudienceProfile;
  private readonly revocation: RevocationCheck | undefined;

  constructor(
    opts: {
      publicKeyPem: string;
      algorithm: 'RS256' | 'RS384' | 'RS512' | 'ES256' | 'ES384' | 'ES512';
      revocation?: RevocationCheck;
    } & JwtAudienceProfile,
  ) {
    this.algorithm = opts.algorithm;
    this.profile = opts;
    this.revocation = opts.revocation;
    this.keyPromise = importSPKI(opts.publicKeyPem, opts.algorithm);
  }

  async verify(token: string): Promise<JwtClaims> {
    const key = await this.keyPromise;
    const { payload } = await jwtVerify(token, key, {
      algorithms: [this.algorithm],
      issuer: this.profile.issuer as string | string[] | undefined,
      audience: this.profile.audience as string | string[] | undefined,
      clockTolerance: (this.profile.clockSkewSeconds ?? 30) + 's',
    });
    const claims = coerceClaims(payload);
    await checkRevocation(claims, this.revocation);
    return claims;
  }
}

/**
 * Remote-JWKS verifier with two-tier cache:
 *   1. In-memory `keys` set, refreshed on TTL or `kid` miss.
 *   2. Persistent `JwksCacheStore` (DB table) for cold-boot.
 *
 * On every verify we resolve the key set via `getKey`:
 *   - If memory cache is fresh, use it.
 *   - Else, fetch from `jwksUri`, refresh both caches.
 *
 * If verification fails with "no key for kid", we hard-refresh from
 * the network exactly once (covers key rotation).
 */
export class JwksVerifier implements JwtVerifier {
  private readonly jwksUri: string;
  private readonly profile: JwtAudienceProfile;
  private readonly algorithms: ReadonlyArray<string>;
  private readonly cacheStore: JwksCacheStore | undefined;
  private readonly cacheTtlMs: number;
  private readonly revocation: RevocationCheck | undefined;

  private inMemory: { keys: JWK[]; expiresAt: number } | null = null;
  private localGetKey: JWTVerifyGetKey | null = null;
  private remoteGetKey: JWTVerifyGetKey | null = null;

  constructor(
    opts: {
      jwksUri: string;
      algorithms?: ReadonlyArray<string>;
      cacheStore?: JwksCacheStore;
      cacheTtlMs?: number;
      revocation?: RevocationCheck;
    } & JwtAudienceProfile,
  ) {
    this.jwksUri = opts.jwksUri;
    this.profile = opts;
    this.algorithms = opts.algorithms ?? DEFAULT_JWKS_ALGS;
    this.cacheStore = opts.cacheStore;
    this.cacheTtlMs = opts.cacheTtlMs ?? 10 * 60 * 1000;
    this.revocation = opts.revocation;
  }

  async verify(token: string): Promise<JwtClaims> {
    const getKey = await this.resolveGetKey();
    let result: { payload: JWTPayload };
    try {
      result = await jwtVerify(token, getKey, {
        algorithms: [...this.algorithms],
        issuer: this.profile.issuer as string | string[] | undefined,
        audience: this.profile.audience as string | string[] | undefined,
        clockTolerance: (this.profile.clockSkewSeconds ?? 30) + 's',
      });
    } catch (err) {
      // Key rotation: if the JWT references an unknown kid, jose's
      // remote JWKS already retries via the standard cache. Our local
      // cache might be stale though; invalidate and try the remote
      // fetcher directly exactly once.
      if (isKidMiss(err)) {
        this.inMemory = null;
        this.localGetKey = null;
        const fresh = this.remoteFetcher();
        result = await jwtVerify(token, fresh, {
          algorithms: [...this.algorithms],
          issuer: this.profile.issuer as string | string[] | undefined,
          audience: this.profile.audience as string | string[] | undefined,
          clockTolerance: (this.profile.clockSkewSeconds ?? 30) + 's',
        });
      } else {
        throw err;
      }
    }
    const claims = coerceClaims(result.payload);
    await checkRevocation(claims, this.revocation);
    return claims;
  }

  /**
   * Hot path: prefer the in-memory local JWKS set; fall back to
   * persistent cache; finally hit the wire via `createRemoteJWKSet`.
   * The first successful fetch warms both tiers.
   */
  private async resolveGetKey(): Promise<JWTVerifyGetKey> {
    const now = Date.now();
    if (this.inMemory && this.inMemory.expiresAt > now && this.localGetKey) {
      return this.localGetKey;
    }
    if (this.cacheStore) {
      const persisted = await this.cacheStore.get(this.jwksUri);
      if (persisted && persisted.expiresAt > now) {
        this.inMemory = { keys: persisted.jwks.keys, expiresAt: persisted.expiresAt };
        this.localGetKey = createLocalJWKSet(persisted.jwks);
        return this.localGetKey;
      }
    }
    return this.remoteFetcher();
  }

  private remoteFetcher(): JWTVerifyGetKey {
    // `createRemoteJWKSet` has its own in-memory TTL cache; we wrap
    // a single instance and reuse it. On every call jose checks its
    // cache first, so this is cheap. We also refresh our own cache
    // after a successful fetch by hooking into the function.
    if (!this.remoteGetKey) {
      const remote = createRemoteJWKSet(new URL(this.jwksUri), {
        cooldownDuration: 30_000,
        cacheMaxAge: this.cacheTtlMs,
      });
      // After-the-fact persistence: every verify path that returns
      // successfully calls `getKey(header, token)` exactly once, so
      // wrap it to fan-out into our persistent cache. We can't peek
      // jose's internal cache, but we can refetch the JWKS once and
      // store it.
      this.remoteGetKey = (async (header, token) => {
        const key = await remote(header, token);
        // Best-effort persistence; failure must not affect verify.
        if (this.cacheStore) {
          this.persistJwks().catch(() => {
            /* swallow */
          });
        }
        return key;
      }) as JWTVerifyGetKey;
    }
    return this.remoteGetKey;
  }

  private async persistJwks(): Promise<void> {
    if (!this.cacheStore) return;
    try {
      const res = await fetch(this.jwksUri);
      if (!res.ok) return;
      const jwks = (await res.json()) as { keys: JWK[] };
      if (!jwks || !Array.isArray(jwks.keys)) return;
      await this.cacheStore.set(this.jwksUri, jwks, this.cacheTtlMs);
      this.inMemory = { keys: jwks.keys, expiresAt: Date.now() + this.cacheTtlMs };
      this.localGetKey = createLocalJWKSet(jwks);
    } catch {
      // best-effort
    }
  }
}

// ----------------- helpers -----------------

function isKidMiss(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  if (code === 'ERR_JWKS_NO_MATCHING_KEY') return true;
  const msg = (err as { message?: string }).message ?? '';
  return msg.includes('no applicable key');
}

async function checkRevocation(
  claims: JwtClaims,
  revocation: RevocationCheck | undefined,
): Promise<void> {
  if (!revocation || !claims.jti) return;
  if (await revocation.isRevoked(claims.jti)) {
    throw new Error('token revoked');
  }
}

function decodeClaims(payloadB64: string): JwtClaims {
  let claims: JwtClaims;
  try {
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as JwtClaims;
  } catch {
    throw new Error('malformed jwt payload');
  }
  if (typeof claims !== 'object' || claims === null) {
    throw new Error('jwt payload must be an object');
  }
  return claims;
}

function coerceClaims(payload: JWTPayload): JwtClaims {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('jwt payload must be an object');
  }
  const sub = payload.sub;
  const tenant_id = (payload as { tenant_id?: unknown }).tenant_id;
  if (typeof sub !== 'string') throw new Error('jwt missing sub');
  if (typeof tenant_id !== 'string' || !tenant_id) throw new Error('jwt missing tenant_id');
  const claims: JwtClaims = {
    sub,
    tenant_id,
    iat: typeof payload.iat === 'number' ? payload.iat : 0,
    exp: typeof payload.exp === 'number' ? payload.exp : 0,
  };
  const adminScope = (payload as { admin_scope?: unknown }).admin_scope;
  if (Array.isArray(adminScope)) {
    for (const s of adminScope) {
      if (typeof s !== 'string') throw new Error('jwt admin_scope must contain strings');
    }
    claims.admin_scope = adminScope as ReadonlyArray<AdminScope>;
  } else if (adminScope !== undefined) {
    throw new Error('jwt admin_scope must be an array');
  }
  if (typeof payload.jti === 'string') claims.jti = payload.jti;
  return claims;
}

function validateClaims(claims: JwtClaims, profile: JwtAudienceProfile, skew: number): void {
  if (typeof claims.tenant_id !== 'string' || !claims.tenant_id)
    throw new Error('jwt missing tenant_id');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('jwt missing sub');
  if (typeof claims.exp === 'number') {
    const now = Math.floor(Date.now() / 1000);
    if (now > claims.exp + skew) throw new Error('jwt expired');
  }
  if (claims.admin_scope !== undefined) {
    if (!Array.isArray(claims.admin_scope)) {
      throw new Error('jwt admin_scope must be an array');
    }
    for (const s of claims.admin_scope) {
      if (typeof s !== 'string') throw new Error('jwt admin_scope must contain strings');
    }
  }
  if (profile.issuer !== undefined) {
    const exp = profile.issuer;
    const got = (claims as { iss?: string }).iss;
    const ok = Array.isArray(exp) ? exp.includes(got ?? '') : got === exp;
    if (!ok) throw new Error('jwt issuer mismatch');
  }
  if (profile.audience !== undefined) {
    const exp = profile.audience;
    const got = (claims as { aud?: string | string[] }).aud;
    const gotArr = Array.isArray(got) ? got : got ? [got] : [];
    const expArr = Array.isArray(exp) ? exp : [exp];
    if (!expArr.some((a) => gotArr.includes(a))) throw new Error('jwt audience mismatch');
  }
}

/**
 * Returns true if `claims` carries at least one of `wanted` (or `*`).
 * Empty/missing `admin_scope` -> false (engine-only token).
 */
export function hasAdminScope(claims: JwtClaims, wanted: ReadonlyArray<AdminScope>): boolean {
  const have = claims.admin_scope;
  if (!have || have.length === 0) return false;
  if (have.includes('*')) return true;
  for (const w of wanted) {
    if (have.includes(w)) return true;
  }
  return false;
}

/**
 * Mint an HS256 token. Test/dev-only helper. Real cloud control plane uses
 * a different signer and rotates keys via JWKS.
 */
export interface SignDevTokenInput {
  sub: string;
  tenant_id: string;
  ttlSeconds?: number;
  admin_scope?: ReadonlyArray<AdminScope>;
  jti?: string;
  extras?: JwtClaimsExtras;
}

export function signDevToken(secret: string, input: SignDevTokenInput): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? 3600;
  const fullClaims: JwtClaims & JwtClaimsExtras = {
    iat: now,
    exp: now + ttl,
    sub: input.sub,
    tenant_id: input.tenant_id,
    ...(input.admin_scope ? { admin_scope: input.admin_scope } : {}),
    ...(input.jti ? { jti: input.jti } : {}),
    ...(input.extras ?? {}),
  };
  const payloadB64 = base64url(JSON.stringify(fullClaims));
  const data = `${HEADER_HS256}.${payloadB64}`;
  const sig = signHmac(secret, data);
  return `${data}.${sig}`;
}

function signHmac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}
