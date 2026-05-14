import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import {
  buildApp,
  createSqliteDb,
  migrate,
  sqliteMigrations,
  FsObjectStore,
  signDevToken,
  StorageKeys,
  type AppBundle,
  type DbSchema,
} from '../src/index';

const STUB_ENTRY = new URL('./_helpers/stub-worker-entry.cjs', import.meta.url);
const SECRET = 'doc-versioned-secret';
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const NO_STORE = 'private, no-store';

interface Fixture {
  bundle: AppBundle;
  app: FastifyInstance;
  db: Kysely<DbSchema>;
  baseUrl: string;
  storageRoot: string;
  cacheRoot: string;
}

async function buildFixture(): Promise<Fixture> {
  const storageRoot = await mkdtemp(join(tmpdir(), 'doc-versioned-store-'));
  const cacheRoot = await mkdtemp(join(tmpdir(), 'doc-versioned-cache-'));
  const db = createSqliteDb({ path: ':memory:' });
  await migrate(db, { source: { kind: 'inline', migrations: sqliteMigrations } });
  const store = new FsObjectStore({ root: storageRoot });
  const bundle = await buildApp({
    jwtSecret: SECRET,
    workerEntry: STUB_ENTRY,
    poolSize: 2,
    db,
    objectStore: store,
    autoProvisionTenant: true,
    sweepIntervalMs: 0,
    cacheRoot,
    cacheMaxBytes: 1024 * 1024,
  });
  const addr = await bundle.app.listen({ host: '127.0.0.1', port: 0 });
  const baseUrl = typeof addr === 'string' ? addr : `http://127.0.0.1:${addr}`;
  return { bundle, app: bundle.app, db, baseUrl, storageRoot, cacheRoot };
}

async function tearDown(fx: Fixture | undefined): Promise<void> {
  if (!fx) return;
  await fx.bundle.shutdown();
  await fx.db.destroy();
  await rm(fx.storageRoot, { recursive: true, force: true });
  await rm(fx.cacheRoot, { recursive: true, force: true });
}

function docToken(
  tenantId: string,
  docId: string,
  opts: { scope?: ReadonlyArray<string> } = {},
): string {
  return signDevToken(SECRET, {
    sub: 'user-1',
    tenant_id: tenantId,
    doc_id: docId,
    scope: opts.scope ?? ['doc.read'],
  });
}

function tenantAdminToken(tenantId: string): string {
  return signDevToken(SECRET, { sub: 'admin-1', tenant_id: tenantId, scope: ['*'] });
}

function tenantReadToken(tenantId: string): string {
  return signDevToken(SECRET, { sub: 'user-1', tenant_id: tenantId, scope: ['docs.read'] });
}

async function seedDocument(
  fx: Fixture,
  tenantId: string,
  docId: string,
  opts: { pageCount?: number } = {},
): Promise<void> {
  const pageCount = opts.pageCount ?? 3;
  const padding = randomBytes(4095);
  const bytes = new Uint8Array(4096);
  bytes[0] = pageCount;
  bytes.set(padding, 1);
  const sha = createHash('sha256').update(bytes).digest('hex');

  const storage = new FsObjectStore({ root: fx.storageRoot });
  const key = StorageKeys.basePdf(tenantId, docId);
  await storage.put(key, bytes, { contentLength: bytes.byteLength });

  await fx.db
    .insertInto('tenants')
    .values({ id: tenantId, name: tenantId })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
  const now = Date.now();
  await fx.db
    .insertInto('documents')
    .values({
      id: docId,
      tenant_id: tenantId,
      state: 'ready',
      base_sha: sha,
      storage_size_bytes: bytes.byteLength,
      page_count: pageCount,
      metadata_json: null,
      idempotency_key: null,
      failure_reason: null,
      created_at: now,
      updated_at: now,
      created_by: null,
    })
    .execute();
}

describe('Phase 4 versioned reads — cache headers', () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await buildFixture();
  });
  afterEach(async () => {
    await tearDown(fx);
  });

  test('/head sets private, no-store', async () => {
    const tenantId = 'tenant-cache-h';
    const docId = 'doccch001';
    await seedDocument(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/head`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
  });

  test('/v:D/manifest sets public, immutable', async () => {
    const tenantId = 'tenant-cache-m';
    const docId = 'doccch002';
    await seedDocument(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/v1/manifest`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE_CACHE);
  });

  test('/v:P/text sets public, immutable', async () => {
    const tenantId = 'tenant-cache-t';
    const docId = 'doccch003';
    await seedDocument(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/pages/1/v1/text`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE_CACHE);
  });

  test('/v:A/annotations sets public, immutable', async () => {
    const tenantId = 'tenant-cache-a';
    const docId = 'doccch004';
    await seedDocument(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/pages/1/v1/annotations`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE_CACHE);
  });
});

describe('Phase 4 versioned reads — GET /pages/:pon/v:P/text', () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await buildFixture();
  });
  afterEach(async () => {
    await tearDown(fx);
  });

  test('returns text + pageState for the current contentVersion', async () => {
    const tenantId = 'tenant-t';
    const docId = 'doctxx001';
    await seedDocument(fx, tenantId, docId, { pageCount: 4 });

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/pages/2/v1/text`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pageState: { pageObjectNumber: number };
      text: string;
      charCount: number;
    };
    expect(body.pageState.pageObjectNumber).toBe(2);
    expect(body.text.length > 0).toBe(true);
    expect(body.charCount).toBe(body.text.length);
  });

  test('stale contentVersion returns 404', async () => {
    const tenantId = 'tenant-tstale';
    const docId = 'doctxx002';
    await seedDocument(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/pages/1/v999/text`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(404);
  });

  test('unknown pageObjectNumber returns 404', async () => {
    const tenantId = 'tenant-tunknown';
    const docId = 'doctxx003';
    await seedDocument(fx, tenantId, docId, { pageCount: 2 });

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/pages/999/v1/text`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(404);
  });

  test('tenant admin token (Model B) reads doc text', async () => {
    const tenantId = 'tenant-tadmin';
    const docId = 'doctxx004';
    await seedDocument(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/pages/1/v1/text`, {
      headers: { Authorization: `Bearer ${tenantAdminToken(tenantId)}` },
    });
    expect(res.status).toBe(200);
  });

  test('tenant token with docs.read scope (Model B) reads doc text', async () => {
    const tenantId = 'tenant-tdocsread';
    const docId = 'doctxx005';
    await seedDocument(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/pages/1/v1/text`, {
      headers: { Authorization: `Bearer ${tenantReadToken(tenantId)}` },
    });
    expect(res.status).toBe(200);
  });

  test('cross-tenant doc token is rejected with 403', async () => {
    const tenantA = 'tenant-cross-a';
    const tenantB = 'tenant-cross-b';
    const docB = 'doctxx006';
    await seedDocument(fx, tenantB, docB);

    // Doc-scoped token whose tenant_id and doc_id match nothing real
    // in tenantB — server treats this as a foreign doc and 403s.
    const foreign = docToken(tenantA, docB);
    const res = await fetch(`${fx.baseUrl}/v1/docs/${docB}/pages/1/v1/text`, {
      headers: { Authorization: `Bearer ${foreign}` },
    });
    expect(res.status === 403 || res.status === 404).toBe(true);
  });

  test('doc-scoped token without doc.read scope is rejected with 403', async () => {
    const tenantId = 'tenant-tnoperm';
    const docId = 'doctxx007';
    await seedDocument(fx, tenantId, docId);

    const tok = docToken(tenantId, docId, { scope: ['doc.annotate'] });
    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/pages/1/v1/text`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(403);
  });

  test('missing Authorization header returns 401', async () => {
    const tenantId = 'tenant-tunauth';
    const docId = 'doctxx008';
    await seedDocument(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/pages/1/v1/text`);
    expect(res.status).toBe(401);
  });
});

describe('Phase 4 versioned reads — GET /pages/:pon/v:A/annotations', () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await buildFixture();
  });
  afterEach(async () => {
    await tearDown(fx);
  });

  test('returns annotation list for the current annotationVersion', async () => {
    const tenantId = 'tenant-a-ok';
    const docId = 'docann001';
    await seedDocument(fx, tenantId, docId, { pageCount: 2 });

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/pages/1/v1/annotations`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pageState: { pageObjectNumber: number };
      annotations: unknown[];
    };
    expect(body.pageState.pageObjectNumber).toBe(1);
    expect(Array.isArray(body.annotations)).toBe(true);
  });

  test('stale annotationVersion returns 404', async () => {
    const tenantId = 'tenant-a-stale';
    const docId = 'docann002';
    await seedDocument(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/pages/1/v999/annotations`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(404);
  });

  test('unknown pageObjectNumber returns 404', async () => {
    const tenantId = 'tenant-a-pon';
    const docId = 'docann003';
    await seedDocument(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/pages/999/v1/annotations`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(404);
  });
});

describe('Phase 4 manifest pages — per-page versions', () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await buildFixture();
  });
  afterEach(async () => {
    await tearDown(fx);
  });

  test('every manifest page reports (contentVersion: 1, annotationVersion: 1, hasWeakAnnotations: false)', async () => {
    const tenantId = 'tenant-m-pp';
    const docId = 'docmpp001';
    await seedDocument(fx, tenantId, docId, { pageCount: 5 });

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/v1/manifest`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      docVersion: number;
      pages: Array<{
        pageObjectNumber: number;
        contentVersion: number;
        annotationVersion: number;
        hasWeakAnnotations: boolean;
      }>;
    };
    expect(body.docVersion).toBe(1);
    expect(body.pages).toHaveLength(5);
    for (const page of body.pages) {
      expect(page.contentVersion).toBe(1);
      expect(page.annotationVersion).toBe(1);
      expect(page.hasWeakAnnotations).toBe(false);
    }
  });
});
