import { Buffer } from 'node:buffer';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCloudAdmin } from '@embedpdf/cloud-admin';
import {
  AzureFrontDoorCdnSigner,
  BunnyCdnSigner,
  CloudCdnSigner,
  CloudFrontCdnSigner,
  CustomHmacCdnSigner,
  NoneCdnSigner,
  buildApp,
  createKmsKeyring,
  createSecretResolver,
  createSecretsProviderRegistry,
  createSqliteDb,
  defaultWorkerEntryUrl,
  EventLogService,
  FsObjectStore,
  migrate,
  signDevToken,
  sqliteMigrations,
  type AppBundle,
  type CdnSigner,
  type KmsConfig,
  type SecretsConfig,
  type TenantScope,
} from '@embedpdf/server';

const root = resolve(import.meta.dirname, '..');
const dataRoot = resolve(process.env['EMBEDPDF_SMOKE_DATA_ROOT'] ?? `${root}/.data`);
const enginePort = Number(process.env['EMBEDPDF_SMOKE_ENGINE_PORT'] ?? 3210);
const apiPort = Number(process.env['EMBEDPDF_SMOKE_API_PORT'] ?? 3211);
const host = process.env['EMBEDPDF_SMOKE_HOST'] ?? '127.0.0.1';
const defaultTenant = process.env['EMBEDPDF_SMOKE_TENANT'] ?? 'tenant-demo';
const staticKmsKek =
  process.env['EMBEDPDF_SMOKE_STATIC_KMS_KEK'] ?? Buffer.alloc(32, 7).toString('base64');

/**
 * Which CDN signer to mount. Set `EMBEDPDF_SMOKE_CDN` to one of:
 *   none, bunny, cloud-cdn, cloudfront-cookies, cloudfront-urls,
 *   azure-fd, custom-hmac-query, custom-hmac-header
 *
 * Defaults to `bunny` so the inspector panel has something interesting
 * to show. All adapters are configured with FAKE hostnames/secrets —
 * the goal is to see what URLs and tokens the server emits, not to
 * actually hit a real edge.
 */
const cdnKind = (process.env['EMBEDPDF_SMOKE_CDN'] ?? 'bunny').toLowerCase();
const smokeSecretRefs = {
  jwtSigningSecret: { provider: 'env', name: 'EMBEDPDF_SMOKE_JWT_SECRET' },
  staticKmsKek: { provider: 'env', name: 'EMBEDPDF_SMOKE_STATIC_KMS_KEK', encoding: 'base64' },
} as const;
const smokeSecretsConfig = {
  providers: {
    env: { kind: 'env' },
  },
  cache: { ttlSec: 3600 },
} satisfies SecretsConfig;
const smokeKmsConfig = {
  kind: 'static',
  keyId: 'cloud-smoke-static',
  kek: smokeSecretRefs.staticKmsKek,
} satisfies KmsConfig;

const engineBaseUrl = `http://${host}:${enginePort}`;
const DEFAULT_DOC_SCOPE = [
  'doc.open',
  'doc.render',
  'doc.text.select',
  'doc.text.copy',
  'doc.annotate.read',
  'doc.annotate.modify',
  'doc.pages.assemble',
  'doc.download',
  'doc.download.flattened',
] as const;

let db: ReturnType<typeof createSqliteDb>;
let embedpdf: AppBundle;
let storage: FsObjectStore;
let jwtSigningSecret: string;
let cdnSigner: CdnSigner;

await startEmbedPdfServer();
await startApiServer();

async function startEmbedPdfServer(): Promise<void> {
  await mkdir(dataRoot, { recursive: true });
  await mkdir(`${dataRoot}/objects`, { recursive: true });
  await mkdir(`${dataRoot}/cache`, { recursive: true });

  db = createSqliteDb({ path: `${dataRoot}/embedpdf.db` });
  await migrate(db, { source: { kind: 'inline', migrations: sqliteMigrations } });
  storage = new FsObjectStore({ root: `${dataRoot}/objects` });
  const securityEnv = {
    ...process.env,
    EMBEDPDF_SMOKE_JWT_SECRET:
      process.env['EMBEDPDF_SMOKE_JWT_SECRET'] ?? 'embedpdf-dev-secret-change-me',
    EMBEDPDF_SMOKE_STATIC_KMS_KEK: staticKmsKek,
  };
  const secrets = createSecretsProviderRegistry(smokeSecretsConfig, { env: securityEnv });
  const resolver = createSecretResolver(secrets);
  const [kms, resolvedSecrets] = await Promise.all([
    createKmsKeyring(smokeKmsConfig, { resolver }),
    resolver.resolve({
      jwtSecret: {
        ref: smokeSecretRefs.jwtSigningSecret,
        as: 'string',
      },
    }),
  ]);
  jwtSigningSecret = resolvedSecrets.jwtSecret;

  cdnSigner = buildSmokeCdnSigner(cdnKind);
  console.log(`[cloud-smoke] CDN signer: ${cdnSigner.info.kind} ${JSON.stringify(cdnSigner.info)}`);

  embedpdf = await buildApp({
    verifier: { mode: 'hs256', secret: jwtSigningSecret },
    kms,
    workerEntry: defaultWorkerEntryUrl,
    poolSize: 1,
    db,
    objectStore: storage,
    autoProvisionTenant: true,
    sweepIntervalMs: 0,
    cacheRoot: `${dataRoot}/cache`,
    cacheMaxBytes: 512 * 1024 * 1024,
    cdnSigner,
  });
  await embedpdf.app.listen({ host, port: enginePort });
  console.log(`[cloud-smoke] EmbedPDF server: ${engineBaseUrl}`);
}

/**
 * Build whatever CDN signer the operator asked for. Everything uses
 * fake/development credentials — the resulting tokens are deterministic
 * but won't actually validate against a real CDN edge. The point is to
 * SHOW the signed-URL shape in the inspector, not to authenticate.
 */
function buildSmokeCdnSigner(kind: string): CdnSigner {
  switch (kind) {
    case 'none':
      return new NoneCdnSigner();
    case 'bunny':
      return new BunnyCdnSigner({
        zoneHostname: 'embedpdf-smoke.b-cdn.net',
        zoneToken: 'smoke-bunny-zone-token-not-real',
      });
    case 'cloud-cdn':
      // 16-byte HMAC key for HMAC-SHA1 ('AAAA...' decoded from base64).
      return new CloudCdnSigner({
        urlPrefix: 'https://embedpdf-smoke.cdn.googleapis.com',
        keyName: 'smoke-key',
        keyValue: Buffer.alloc(16, 7).toString('base64'),
      });
    case 'cloudfront-cookies':
    case 'cloudfront-urls':
      // Generate an ephemeral RSA key per boot — production callers
      // load this from a SecretRef.
      return new CloudFrontCdnSigner({
        distributionDomain: 'd1smokeexample.cloudfront.net',
        keyPairId: 'KSMOKEPAIR000000',
        privateKeyPem: getOrGenerateRsaKey(),
        mode: kind === 'cloudfront-urls' ? 'urls' : 'cookies',
      });
    case 'azure-fd':
      return new AzureFrontDoorCdnSigner({
        endpoint: 'https://embedpdf-smoke.azurefd.net',
        secret: 'smoke-azure-fd-secret-not-real',
      });
    case 'custom-hmac-query':
      return new CustomHmacCdnSigner({
        cdnOrigin: 'https://cdn.smoke.example.com',
        secret: 'smoke-custom-hmac-secret',
        transport: 'query',
      });
    case 'custom-hmac-header':
      return new CustomHmacCdnSigner({
        cdnOrigin: 'https://cdn.smoke.example.com',
        secret: 'smoke-custom-hmac-secret',
        transport: 'header',
      });
    default:
      throw new Error(
        `Unknown EMBEDPDF_SMOKE_CDN=${kind}. Valid: none, bunny, cloud-cdn, cloudfront-cookies, cloudfront-urls, azure-fd, custom-hmac-query, custom-hmac-header.`,
      );
  }
}

let cachedRsaKey: string | null = null;
function getOrGenerateRsaKey(): string {
  if (cachedRsaKey) return cachedRsaKey;
  // Lazy import keeps node:crypto's generateKeyPairSync out of the
  // hot path when CloudFront isn't selected.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { generateKeyPairSync } = require('node:crypto') as typeof import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  cachedRsaKey = privateKey as string;
  return cachedRsaKey;
}

async function startApiServer(): Promise<void> {
  const server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      sendJson(res, 500, {
        error: {
          message: err instanceof Error ? err.message : String(err),
          stack: process.env['NODE_ENV'] === 'production' ? undefined : (err as Error)?.stack,
        },
      });
    }
  });
  server.listen(apiPort, host, () => {
    console.log(`[cloud-smoke] Admin helper: http://${host}:${apiPort}`);
  });

  const shutdown = async () => {
    server.close();
    await embedpdf.shutdown();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${apiPort}`}`);
  if (req.method === 'GET' && url.pathname === '/api/config') {
    sendJson(res, 200, {
      tenantId: defaultTenant,
      engineBaseUrl: '',
      originBaseUrl: engineBaseUrl,
      dataRoot,
      cdn: { kind: cdnKind, info: cdnSigner.info },
    });
    return;
  }

  // Mirror of /v1/access for the inspector — takes the doc token in the
  // body (instead of an Authorization header) and forwards through the
  // smoke server's own fetch, so the browser doesn't need to know
  // anything about the engine port or auth header shape.
  if (req.method === 'POST' && url.pathname === '/api/admin/access') {
    const body = (await readJson(req)) as Record<string, unknown>;
    const token = readString(body, 'token');
    const docId = readString(body, 'docId');
    const layerName = readString(body, 'layerName', 'default');
    const password = typeof body['password'] === 'string' ? (body['password'] as string) : null;
    const upstream = await fetch(`${engineBaseUrl}/v1/access`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        docId,
        layerName,
        ...(password ? { password } : {}),
      }),
    });
    const text = await upstream.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave as raw text
    }
    sendJson(res, upstream.status, parsed);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/documents') {
    const tenantId = url.searchParams.get('tenantId') || defaultTenant;
    const docs = await adminForTenant(tenantId).documents.list({ limit: 50 });
    sendJson(res, 200, { documents: docs });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/upload') {
    const tenantId = url.searchParams.get('tenantId') || defaultTenant;
    const layerName = url.searchParams.get('layerName') || 'default';
    const sub = url.searchParams.get('sub') || 'demo-user';
    const scope = readScopeFromSearch(url);
    const identity = readIdentityFromSearch(url);
    const fileName = req.headers['x-file-name']?.toString() || 'upload.pdf';
    const bytes = await readBody(req);
    if (bytes.byteLength === 0) {
      sendJson(res, 400, { error: { message: 'empty upload body' } });
      return;
    }
    const created = await adminForTenant(tenantId).documents.create({
      bytes,
      metadata: {
        name: fileName,
        source: 'cloud-platform-smoke',
      },
      idempotencyKey: `smoke-${tenantId}-${fileName}-${bytes.byteLength}-${Date.now()}`,
    });
    const token = mintDocToken({
      tenantId,
      docId: created.document.id,
      layerName,
      sub,
      scope,
      identity,
    });
    sendJson(res, 200, {
      ...created,
      token,
      layerName,
      tenantId,
      sub,
      scope,
      identity,
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/mint-token') {
    const body = await readJson(req);
    const tenantId = readString(body, 'tenantId', defaultTenant);
    const docId = readString(body, 'docId');
    const layerName = readString(body, 'layerName', 'default');
    const sub = readString(body, 'sub', 'demo-user');
    const ttlSeconds = readNumber(body, 'ttlSeconds', 3600);
    const scope = readStringArray(body, 'scope', [...DEFAULT_DOC_SCOPE]);
    const identity = readIdentityFromBody(body);
    const token = mintDocToken({ tenantId, docId, layerName, sub, ttlSeconds, scope, identity });
    sendJson(res, 200, { token, tenantId, docId, layerName, sub, ttlSeconds, scope, identity });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/audit-export') {
    const body = await readJson(req);
    const tenantId = readString(body, 'tenantId', defaultTenant);
    const docId = readString(body, 'docId');
    const day = readString(body, 'day');
    const allowOpenDay = Boolean((body as Record<string, unknown>)['allowOpenDay']);
    const result = await new EventLogService({ storage }).exportDocDayJsonl(db, {
      tenantId,
      docId,
      day,
      allowOpenDay,
      force: Boolean((body as Record<string, unknown>)['force']),
    });
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: { message: `not found: ${req.method} ${url.pathname}` } });
}

function adminForTenant(tenantId: string) {
  return createCloudAdmin({
    baseUrl: engineBaseUrl,
    tenantToken: signDevToken(jwtSigningSecret, {
      sub: 'cloud-smoke-admin',
      tenant_id: tenantId,
      scope: ['*'] satisfies TenantScope[],
      ttlSeconds: 60 * 60,
    }),
  });
}

function mintDocToken(input: {
  tenantId: string;
  docId: string;
  layerName: string;
  sub: string;
  ttlSeconds?: number;
  scope?: ReadonlyArray<string>;
  identity?: {
    user_id?: string;
    group_id?: string;
    groups?: string[];
    display_name?: string;
  };
}): string {
  return signDevToken(jwtSigningSecret, {
    sub: input.sub,
    tenant_id: input.tenantId,
    doc_id: input.docId,
    layer_name: input.layerName,
    scope: input.scope && input.scope.length > 0 ? input.scope : DEFAULT_DOC_SCOPE,
    ttlSeconds: input.ttlSeconds ?? 60 * 60,
    jti: randomUUID(),
    extras: {
      ...(input.identity ?? {}),
      embedpdf: {
        unlock_key: randomBytes(32).toString('base64url'),
      },
    },
  });
}

function readScopeFromSearch(url: URL): string[] {
  const repeated = url.searchParams
    .getAll('scope')
    .map((value) => value.trim())
    .filter(Boolean);
  if (repeated.length > 0) return repeated;
  const packed = url.searchParams.get('scopes');
  if (!packed) return [...DEFAULT_DOC_SCOPE];
  return splitScopeList(packed);
}

function readIdentityFromSearch(url: URL): {
  user_id?: string;
  group_id?: string;
  groups?: string[];
  display_name?: string;
} {
  const userId = url.searchParams.get('user_id')?.trim();
  const groupId = url.searchParams.get('group_id')?.trim();
  const displayName = url.searchParams.get('display_name')?.trim();
  const groups = splitScopeList(url.searchParams.get('groups') ?? '');
  return {
    ...(userId ? { user_id: userId } : {}),
    ...(groupId ? { group_id: groupId } : {}),
    ...(displayName ? { display_name: displayName } : {}),
    ...(groups.length > 0 ? { groups } : {}),
  };
}

async function readBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const bytes = await readBody(req);
  return JSON.parse(Buffer.from(bytes).toString('utf8') || '{}') as unknown;
}

function readString(body: unknown, key: string, fallback?: string): string {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : null;
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`missing string field: ${key}`);
}

function readStringArray(body: unknown, key: string, fallback: string[] = []): string[] {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : null;
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  }
  if (typeof value === 'string') return splitScopeList(value);
  return fallback;
}

function readIdentityFromBody(body: unknown): {
  user_id?: string;
  group_id?: string;
  groups?: string[];
  display_name?: string;
} {
  return {
    ...readOptionalString(body, 'user_id', 'user_id'),
    ...readOptionalString(body, 'group_id', 'group_id'),
    ...readOptionalString(body, 'display_name', 'display_name'),
    ...readOptionalStringArray(body, 'groups', 'groups'),
  };
}

function readOptionalString<T extends string>(
  body: unknown,
  key: string,
  outKey: T,
): Partial<Record<T, string>> {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : null;
  return typeof value === 'string' && value.trim()
    ? ({ [outKey]: value.trim() } as Partial<Record<T, string>>)
    : {};
}

function readOptionalStringArray<T extends string>(
  body: unknown,
  key: string,
  outKey: T,
): Partial<Record<T, string[]>> {
  const values = readStringArray(body, key);
  return values.length > 0 ? ({ [outKey]: values } as Partial<Record<T, string[]>>) : {};
}

function splitScopeList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function readNumber(body: unknown, key: string, fallback: number): number {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body, null, 2));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(bytes.byteLength),
  });
  res.end(bytes);
}
