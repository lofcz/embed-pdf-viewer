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
const SECRET = 'doc-routes-secret';

interface Fixture {
  bundle: AppBundle;
  app: FastifyInstance;
  db: Kysely<DbSchema>;
  baseUrl: string;
  storageRoot: string;
  cacheRoot: string;
}

async function buildFixture(
  opts: { poolSize?: number; maxDocsPerSlot?: number } = {},
): Promise<Fixture> {
  const storageRoot = await mkdtemp(join(tmpdir(), 'doc-routes-store-'));
  const cacheRoot = await mkdtemp(join(tmpdir(), 'doc-routes-cache-'));
  const db = createSqliteDb({ path: ':memory:' });
  await migrate(db, { source: { kind: 'inline', migrations: sqliteMigrations } });
  const store = new FsObjectStore({ root: storageRoot });
  const bundle = await buildApp({
    verifier: { mode: 'hs256', secret: SECRET },
    workerEntry: STUB_ENTRY,
    poolSize: opts.poolSize ?? 2,
    db,
    objectStore: store,
    autoProvisionTenant: true,
    sweepIntervalMs: 0,
    cacheRoot,
    cacheMaxBytes: 1024 * 1024,
    maxDocsPerSlot: opts.maxDocsPerSlot,
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

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 500;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (err) {
      last = err;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (last) throw last;
  assertion();
}

function docToken(
  tenantId: string,
  docId: string,
  opts: { layer?: string; scope?: ReadonlyArray<string> } = {},
): string {
  return signDevToken(SECRET, {
    sub: 'user-1',
    tenant_id: tenantId,
    doc_id: docId,
    scope: opts.scope ?? ['doc.read'],
    ...(opts.layer ? { layer_name: opts.layer } : {}),
  });
}

function adminToken(tenantId: string): string {
  return signDevToken(SECRET, { sub: 'admin-1', tenant_id: tenantId, scope: ['*'] });
}

function tenantOnlyToken(tenantId: string): string {
  return signDevToken(SECRET, { sub: 'user-1', tenant_id: tenantId });
}

/**
 * Seed a `ready` document by inserting a tenant row + documents row
 * directly + uploading the bytes. Phase 5's lifecycle service will
 * do this for us; for Phase 3 we sidestep it because the upload
 * pipeline isn't the unit under test.
 *
 * The stub worker interprets the first byte of the payload as the
 * page count, so callers can vary `pageCount` via the bytes pattern.
 */
async function seedDocument(
  fx: Fixture,
  tenantId: string,
  docId: string,
  opts: { pageCount?: number } = {},
): Promise<{ sha: string; size: number }> {
  const pageCount = opts.pageCount ?? 3;
  // First byte = page count, rest = padding so we exercise the
  // materialise + transfer path with something non-trivial.
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
      metadata_json: null,
      idempotency_key: null,
      failure_reason: null,
      created_at: now,
      updated_at: now,
      created_by: null,
    })
    .execute();
  return { sha, size: bytes.byteLength };
}

async function setPending(fx: Fixture, tenantId: string, docId: string): Promise<void> {
  const now = Date.now();
  await fx.db
    .insertInto('tenants')
    .values({ id: tenantId, name: tenantId })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
  await fx.db
    .insertInto('documents')
    .values({
      id: docId,
      tenant_id: tenantId,
      state: 'pending',
      base_sha: null,
      storage_size_bytes: null,
      metadata_json: null,
      idempotency_key: null,
      failure_reason: null,
      created_at: now,
      updated_at: now,
      created_by: null,
    })
    .execute();
}

describe('Phase 3 doc routes — GET /v1/docs/:docId/head', () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await buildFixture();
  });
  afterEach(async () => {
    await tearDown(fx);
  });

  test('returns head info for a ready doc with a doc-scoped token', async () => {
    const tenantId = 'tenant-a';
    const docId = 'docabc123';
    const seed = await seedDocument(fx, tenantId, docId, { pageCount: 7 });

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/head`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: docId,
      baseSha: seed.sha,
      docVersion: 1,
      state: 'ready',
      encryption: { state: 'unknown', requiresPassword: null },
      permissions: {
        known: false,
        bits: null,
        allAllowed: null,
        openedAs: null,
        securityHandlerRevision: null,
        canUpgradeToOwner: false,
      },
      access: { required: true, reasons: ['permissions-unknown'], endpoint: '/v1/access' },
    });
  });

  test('returns head from DB and schedules a worker warm hint', async () => {
    const tenantId = 'tenant-pin';
    const docId = 'docpin111';
    await seedDocument(fx, tenantId, docId, { pageCount: 2 });

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/head`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(200);
    await waitFor(() => {
      expect(fx.bundle.baseFileCache!.stats().refcounted).toBe(1);
      expect(fx.bundle.documentService!.stats().pinnedBaseFiles).toBe(1);
    });
  });

  test('repeated head calls share the same warm open', async () => {
    const tenantId = 'tenant-cache';
    const docId = 'docccc111';
    await seedDocument(fx, tenantId, docId);
    const cache = fx.bundle.baseFileCache!;
    const events: string[] = [];
    // Re-instrument the cache to log just for this test; we need to
    // see whether the second open re-enters materialise.
    const orig = (cache as unknown as { onEvent?: (e: { kind: string }) => void }).onEvent;
    (cache as unknown as { onEvent?: (e: { kind: string }) => void }).onEvent = (e) => {
      events.push(e.kind);
      orig?.(e);
    };

    const tok = docToken(tenantId, docId);
    const r1 = await fetch(`${fx.baseUrl}/v1/docs/${docId}/head`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(r1.status).toBe(200);
    await waitFor(() => {
      expect(events.filter((k) => k === 'materialize-start').length).toBe(1);
    });

    const r2 = await fetch(`${fx.baseUrl}/v1/docs/${docId}/head`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(r2.status).toBe(200);
    const materializes2 = events.filter((k) => k === 'materialize-start').length;
    expect(materializes2).toBe(1);
  });

  test('accepts a tenant admin token (* scope) on doc routes (Model B)', async () => {
    const tenantId = 'tenant-x';
    const docId = 'docxxx111';
    await seedDocument(fx, tenantId, docId, { pageCount: 4 });

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/head`, {
      headers: { Authorization: `Bearer ${adminToken(tenantId)}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(docId);
  });

  test('rejects a tenant token with no scope', async () => {
    const tenantId = 'tenant-y';
    const docId = 'docyyy111';
    await seedDocument(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/head`, {
      headers: { Authorization: `Bearer ${tenantOnlyToken(tenantId)}` },
    });
    expect(res.status).toBe(403);
  });

  test('rejects a doc token whose doc_id does not match the URL', async () => {
    const tenantId = 'tenant-z';
    await seedDocument(fx, tenantId, 'doczzz111');
    await seedDocument(fx, tenantId, 'doczzz222');

    const res = await fetch(`${fx.baseUrl}/v1/docs/doczzz111/head`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, 'doczzz222')}` },
    });
    expect(res.status).toBe(403);
  });

  test('rejects when the document belongs to a different tenant', async () => {
    await seedDocument(fx, 'tenant-owner', 'docown111');

    const res = await fetch(`${fx.baseUrl}/v1/docs/docown111/head`, {
      headers: { Authorization: `Bearer ${docToken('tenant-attacker', 'docown111')}` },
    });
    expect(res.status).toBe(403);
  });

  test('returns DocOpenFailed for a pending document', async () => {
    const tenantId = 'tenant-pend';
    const docId = 'docpend111';
    await setPending(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/head`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('DocOpenFailed');
  });

  test('returns 404 for a non-existent document', async () => {
    const tenantId = 'tenant-q';
    await fx.db.insertInto('tenants').values({ id: tenantId, name: tenantId }).execute();

    const res = await fetch(`${fx.baseUrl}/v1/docs/nodoc111/head`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, 'nodoc111')}` },
    });
    expect(res.status).toBe(404);
  });
});

describe('Phase 3 doc routes — GET /v1/docs/:docId/manifest@dN', () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await buildFixture();
  });
  afterEach(async () => {
    await tearDown(fx);
  });

  test('returns the page list for the current doc version', async () => {
    const tenantId = 'tenant-m';
    const docId = 'docmmm111';
    await seedDocument(fx, tenantId, docId, { pageCount: 4 });

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/manifest@docVersion=1`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      docVersion: number;
      pages: Array<{
        state: { weakAnnotationState: { kind: string; hasAnyWeakAnnotations: boolean } };
        cache: { contentVersion: number; annotationVersion: number };
      }>;
    };
    expect(body.docVersion).toBe(1);
    expect(body.pages).toHaveLength(4);
    for (const page of body.pages) {
      expect(page.cache.contentVersion).toBe(1);
      expect(page.cache.annotationVersion).toBe(1);
      expect(page.state.weakAnnotationState).toEqual({
        kind: 'known',
        hasAnyWeakAnnotations: false,
      });
    }
  });

  test('returns 404 when the requested structure version is stale', async () => {
    const tenantId = 'tenant-stale';
    const docId = 'docstal111';
    await seedDocument(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/manifest@docVersion=2`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  test('rejects non-numeric structure version', async () => {
    const tenantId = 'tenant-bad';
    const docId = 'docbad1111';
    await seedDocument(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/manifest@docVersion=XX`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId)}` },
    });
    expect(res.status).toBe(400);
  });
});

describe('Phase 3 doc routes — POST /v1/warm', () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await buildFixture();
  });
  afterEach(async () => {
    await tearDown(fx);
  });

  test('pre-populates the head cache so the user request is warm', async () => {
    const tenantId = 'tenant-warm';
    const docId = 'docwrm111';
    await seedDocument(fx, tenantId, docId);
    const cache = fx.bundle.baseFileCache!;
    const events: string[] = [];
    (cache as unknown as { onEvent?: (e: { kind: string }) => void }).onEvent = (e) =>
      events.push(e.kind);

    const tok = docToken(tenantId, docId);
    const warmRes = await fetch(`${fx.baseUrl}/v1/warm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId }),
    });
    expect(warmRes.status).toBe(200);
    const materializesAfterWarm = events.filter((k) => k === 'materialize-start').length;
    expect(materializesAfterWarm).toBe(1);

    const headRes = await fetch(`${fx.baseUrl}/v1/docs/${docId}/head`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(headRes.status).toBe(200);
    const materializesAfterHead = events.filter((k) => k === 'materialize-start').length;
    expect(materializesAfterHead).toBe(1);
  });

  test('requires a docId in the body', async () => {
    const tenantId = 'tenant-no-body';
    const docId = 'docnob111';
    await seedDocument(fx, tenantId, docId);
    const res = await fetch(`${fx.baseUrl}/v1/warm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${docToken(tenantId, docId)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test('rejects a warm for a doc the token does not grant access to', async () => {
    const tenantId = 'tenant-warm-bad';
    await seedDocument(fx, tenantId, 'docwbd111');
    await seedDocument(fx, tenantId, 'docwbd222');

    const res = await fetch(`${fx.baseUrl}/v1/warm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${docToken(tenantId, 'docwbd111')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ docId: 'docwbd222' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('Phase 6 access route — POST /v1/access', () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await buildFixture();
  });
  afterEach(async () => {
    await tearDown(fx);
  });

  test('returns shared security state and none-CDN access info', async () => {
    const tenantId = 'tenant-access';
    const docId = 'docacc111';
    await seedDocument(fx, tenantId, docId);

    const res = await fetch(`${fx.baseUrl}/v1/access`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${docToken(tenantId, docId, { layer: 'default' })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ docId, layerName: 'default' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      security: { encryption: { state: string }; permissions: { known: boolean } };
      cdn: { adapter: string; cache: { immutableVersionedReads: boolean } };
    };
    expect(body.security.encryption.state).toBe('none');
    expect(body.security.permissions.known).toBe(true);
    expect(body.cdn).toMatchObject({
      adapter: 'none',
      cache: { immutableVersionedReads: true },
    });
  });

  test('verification cache stores SQLite-safe values and can be reused', async () => {
    const tenantId = 'tenant-access-cache';
    const docId = 'docacc222';
    await seedDocument(fx, tenantId, docId);
    const token = docToken(tenantId, docId, { layer: 'default' });
    const body = { docId, layerName: 'default', password: 'Test', mode: 'any' };

    const first = await fetch(`${fx.baseUrl}/v1/access`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${fx.baseUrl}/v1/access`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    expect(second.status).toBe(200);

    const rows = await fx.db.selectFrom('pdf_password_verifications').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pdf_permissions_all_allowed).toBe(1);
  });
});

describe('Phase 3 doc routes — concurrency', () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await buildFixture();
  });
  afterEach(async () => {
    await tearDown(fx);
  });

  test('concurrent /head calls share one warm open', async () => {
    const tenantId = 'tenant-concurrent';
    const docId = 'doccon1111';
    await seedDocument(fx, tenantId, docId);
    const cache = fx.bundle.baseFileCache!;
    const events: string[] = [];
    (cache as unknown as { onEvent?: (e: { kind: string }) => void }).onEvent = (e) =>
      events.push(e.kind);

    const tok = docToken(tenantId, docId);
    const responses = await Promise.all(
      Array.from({ length: 16 }, () =>
        fetch(`${fx.baseUrl}/v1/docs/${docId}/head`, {
          headers: { Authorization: `Bearer ${tok}` },
        }),
      ),
    );
    for (const r of responses) expect(r.status).toBe(200);
    await waitFor(() => {
      expect(events.filter((k) => k === 'materialize-start').length).toBe(1);
    });
  });

  test('pool eviction releases the pinned base-file handle', async () => {
    await tearDown(fx);
    fx = await buildFixture({ poolSize: 1, maxDocsPerSlot: 1 });

    const tenantId = 'tenant-evict';
    const docA = 'doceva111';
    const docB = 'docevb222';
    await seedDocument(fx, tenantId, docA, { pageCount: 1 });
    await seedDocument(fx, tenantId, docB, { pageCount: 2 });

    const resA = await fetch(`${fx.baseUrl}/v1/docs/${docA}/manifest@docVersion=1`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docA)}` },
    });
    expect(resA.status).toBe(200);
    expect(fx.bundle.baseFileCache!.stats().refcounted).toBe(1);

    const resB = await fetch(`${fx.baseUrl}/v1/docs/${docB}/manifest@docVersion=1`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docB)}` },
    });
    expect(resB.status).toBe(200);

    expect(fx.bundle.baseFileCache!.stats().refcounted).toBe(1);
    expect(fx.bundle.documentService!.stats().openHeads).toBe(1);
  });
});
