import { Buffer } from 'node:buffer';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCloudAdmin } from '@embedpdf/cloud-admin';
import {
  buildApp,
  createSqliteDb,
  defaultWorkerEntryUrl,
  EventLogService,
  FsObjectStore,
  migrate,
  signDevToken,
  sqliteMigrations,
  type AppBundle,
  type DocScope,
  type TenantScope,
} from '@embedpdf/server';

const root = resolve(import.meta.dirname, '..');
const dataRoot = resolve(process.env['EMBEDPDF_SMOKE_DATA_ROOT'] ?? `${root}/.data`);
const enginePort = Number(process.env['EMBEDPDF_SMOKE_ENGINE_PORT'] ?? 3210);
const apiPort = Number(process.env['EMBEDPDF_SMOKE_API_PORT'] ?? 3211);
const host = process.env['EMBEDPDF_SMOKE_HOST'] ?? '127.0.0.1';
const jwtSecret = process.env['EMBEDPDF_SMOKE_JWT_SECRET'] ?? 'embedpdf-dev-secret-change-me';
const defaultTenant = process.env['EMBEDPDF_SMOKE_TENANT'] ?? 'tenant-demo';

const engineBaseUrl = `http://${host}:${enginePort}`;

let db: ReturnType<typeof createSqliteDb>;
let embedpdf: AppBundle;
let storage: FsObjectStore;

await startEmbedPdfServer();
await startApiServer();

async function startEmbedPdfServer(): Promise<void> {
  await mkdir(dataRoot, { recursive: true });
  await mkdir(`${dataRoot}/objects`, { recursive: true });
  await mkdir(`${dataRoot}/cache`, { recursive: true });

  db = createSqliteDb({ path: `${dataRoot}/embedpdf.db` });
  await migrate(db, { source: { kind: 'inline', migrations: sqliteMigrations } });
  storage = new FsObjectStore({ root: `${dataRoot}/objects` });

  embedpdf = await buildApp({
    jwtSecret,
    workerEntry: defaultWorkerEntryUrl,
    poolSize: 1,
    db,
    objectStore: storage,
    autoProvisionTenant: true,
    sweepIntervalMs: 0,
    cacheRoot: `${dataRoot}/cache`,
    cacheMaxBytes: 512 * 1024 * 1024,
  });
  await embedpdf.app.listen({ host, port: enginePort });
  console.log(`[cloud-smoke] EmbedPDF server: ${engineBaseUrl}`);
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
    });
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
    });
    sendJson(res, 200, {
      ...created,
      token,
      layerName,
      tenantId,
      sub,
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
    const token = mintDocToken({ tenantId, docId, layerName, sub, ttlSeconds });
    sendJson(res, 200, { token, tenantId, docId, layerName, sub, ttlSeconds });
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
    tenantToken: signDevToken(jwtSecret, {
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
}): string {
  return signDevToken(jwtSecret, {
    sub: input.sub,
    tenant_id: input.tenantId,
    doc_id: input.docId,
    layer_name: input.layerName,
    scope: ['doc.read', 'doc.annotate', 'doc.edit-pages', 'doc.download'] satisfies DocScope[],
    ttlSeconds: input.ttlSeconds ?? 60 * 60,
  });
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
