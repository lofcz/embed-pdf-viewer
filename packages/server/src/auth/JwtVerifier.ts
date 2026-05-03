import { createHmac, timingSafeEqual } from 'node:crypto';

export interface JwtClaims {
  sub: string;
  tenant_id: string;
  iat: number;
  exp: number;
}

export type JwtClaimsExtras = Record<string, unknown>;

export interface JwtVerifierOptions {
  /** HS256 secret used to sign and verify tokens. */
  secret: string;
  /** Skew tolerance in seconds when validating exp. Defaults to 30s. */
  clockSkewSeconds?: number;
}

const HEADER_HS256 = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

/**
 * Tiny dev-mode JWT verifier (HS256). Production deployments will swap
 * this for a real JWKS-aware verifier driven by the SaaS control plane.
 */
export class JwtVerifier {
  private readonly secret: string;
  private readonly skew: number;

  constructor(opts: JwtVerifierOptions) {
    this.secret = opts.secret;
    this.skew = opts.clockSkewSeconds ?? 30;
  }

  verify(token: string): JwtClaims {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('malformed jwt');
    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

    const expected = sign(this.secret, `${headerB64}.${payloadB64}`);
    const got = Buffer.from(sigB64, 'base64url');
    const want = Buffer.from(expected, 'base64url');
    if (got.length !== want.length || !timingSafeEqual(got, want)) {
      throw new Error('invalid jwt signature');
    }
    let claims: JwtClaims;
    try {
      claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as JwtClaims;
    } catch {
      throw new Error('malformed jwt payload');
    }
    if (typeof claims !== 'object' || claims === null)
      throw new Error('jwt payload must be an object');
    if (typeof claims.tenant_id !== 'string' || !claims.tenant_id)
      throw new Error('jwt missing tenant_id');
    if (typeof claims.exp === 'number') {
      const now = Math.floor(Date.now() / 1000);
      if (now > claims.exp + this.skew) throw new Error('jwt expired');
    }
    return claims;
  }
}

/**
 * Mint an HS256 token. Test/dev-only helper. Real cloud control plane uses
 * a different signer and rotates keys via JWKS.
 */
export interface SignDevTokenInput {
  sub: string;
  tenant_id: string;
  ttlSeconds?: number;
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
    ...(input.extras ?? {}),
  };
  const payloadB64 = base64url(JSON.stringify(fullClaims));
  const data = `${HEADER_HS256}.${payloadB64}`;
  const sig = sign(secret, data);
  return `${data}.${sig}`;
}

function sign(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}
