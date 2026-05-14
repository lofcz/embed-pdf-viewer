import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import {
  buildApp,
  createSqliteDb,
  FsObjectStore,
  migrate,
  signDevToken,
  sqliteMigrations,
  StorageKeys,
  type AppBundle,
  type DbSchema,
} from '../src/index';
import { createCloudAdmin, AdminError } from '@embedpdf/cloud-admin';

const SECRET = 'admin-e2e-secret';

interface Fixture {
  bundle: AppBundle;
  app: FastifyInstance;
  db: Kysely<DbSchema>;
  store: FsObjectStore;
  baseUrl: string;
  storageRoot: string;
}

async function buildFixture(opts: { sweepIntervalMs?: number } = {}): Promise<Fixture> {
  const storageRoot = await mkdtemp(join(tmpdir(), 'embedpdf-admin-e2e-'));
  const db = createSqliteDb({ path: ':memory:' });
  await migrate(db, { source: { kind: 'inline', migrations: sqliteMigrations } });
  const store = new FsObjectStore({ root: storageRoot });

  const bundle = await buildApp({
    jwtSecret: SECRET,
    // Phase 1 admin-only tests don't need the worker pool.
    workerEntry: null,
    db,
    objectStore: store,
    autoProvisionTenant: true,
    sweepIntervalMs: opts.sweepIntervalMs ?? 0,
    pendingTtlMs: 100,
  });
  const addr = await bundle.app.listen({ host: '127.0.0.1', port: 0 });
  const baseUrl = typeof addr === 'string' ? addr : `http://127.0.0.1:${addr}`;
  return { bundle, app: bundle.app, db, store, baseUrl, storageRoot };
}

async function tearDown(fx: Fixture | undefined): Promise<void> {
  if (!fx) return;
  await fx.bundle.shutdown();
  await fx.db.destroy();
  await rm(fx.storageRoot, { recursive: true, force: true });
}

function adminToken(
  tenantId: string,
  opts: { scope?: ('*' | 'docs.create' | 'docs.read' | 'docs.delete')[] } = {},
): string {
  return signDevToken(SECRET, {
    sub: `admin-${tenantId}`,
    tenant_id: tenantId,
    admin_scope: opts.scope ?? ['*'],
  });
}

function fakePdf(seed: number, size: number): Uint8Array {
  const arr = new Uint8Array(size);
  for (let i = 0; i < size; i++) arr[i] = (i * 31 + seed * 7) & 0xff;
  return arr;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('Admin documents E2E (FS adapter)', () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await buildFixture();
  });
  afterAll(async () => {
    await tearDown(fx);
  });

  test('documents.create -> ready, with sha verified server-side and bytes round-tripping', async () => {
    const admin = createCloudAdmin({
      baseUrl: fx.baseUrl,
      tenantToken: adminToken('tenant-a'),
    });
    const bytes = fakePdf(1, 4096);

    let progressMax = 0;
    const result = await admin.documents.create({
      bytes,
      metadata: { name: 'Q1 Report' },
      onProgress: (loaded) => {
        progressMax = Math.max(progressMax, loaded);
      },
    });

    expect(result.tag).toBe('created');
    expect(result.document.state).toBe('ready');
    expect(result.document.baseSha).toBe(sha256Hex(bytes));
    expect(result.document.metadata).toEqual({ name: 'Q1 Report' });
    expect(progressMax).toBe(bytes.byteLength);

    const back = await admin.documents.download(result.document.id);
    expect(back.byteLength).toBe(bytes.byteLength);
    expect(sha256Hex(back)).toBe(result.document.baseSha);

    // Listing shows the doc.
    const list = await admin.documents.list();
    expect(list.find((d) => d.id === result.document.id)).toBeTruthy();
  });

  test('idempotency-key returns the same doc on retry without re-uploading', async () => {
    const admin = createCloudAdmin({
      baseUrl: fx.baseUrl,
      tenantToken: adminToken('tenant-idemp'),
    });
    const bytes = fakePdf(2, 2048);
    const key = 'retry-1';

    const first = await admin.documents.create({ bytes, idempotencyKey: key });
    expect(first.tag).toBe('created');

    const second = await admin.documents.create({ bytes, idempotencyKey: key });
    expect(second.tag).toBe('deduped');
    expect(second.document.id).toBe(first.document.id);
  });

  test('dedupMode reuse-existing returns the prior doc when content sha matches', async () => {
    const admin = createCloudAdmin({
      baseUrl: fx.baseUrl,
      tenantToken: adminToken('tenant-dedup'),
    });
    const bytes = fakePdf(3, 1024);
    const first = await admin.documents.create({ bytes });
    const second = await admin.documents.create({ bytes, dedupMode: 'reuse-existing' });
    expect(second.tag).toBe('deduped');
    expect(second.document.id).toBe(first.document.id);

    // always-create (default) makes a distinct doc.
    const third = await admin.documents.create({ bytes });
    expect(third.tag).toBe('created');
    expect(third.document.id).not.toBe(first.document.id);
  });

  test('sha mismatch at commit marks doc failed and returns 400', async () => {
    const admin = createCloudAdmin({
      baseUrl: fx.baseUrl,
      tenantToken: adminToken('tenant-shamm'),
    });
    const bytes = fakePdf(4, 512);
    const declaredButWrongSha = 'f'.repeat(64);

    const init = await admin.documents.init({
      contentLength: bytes.byteLength,
      contentSha256: declaredButWrongSha,
    });
    if (init.tag === 'deduped') throw new Error('unexpected dedup');
    expect(init.upload.kind).toBe('direct'); // FS adapter

    await admin.documents.uploadDirect({
      docId: init.document.id,
      body: bytes,
      contentLength: bytes.byteLength,
    });

    await expect(
      admin.documents.commit({ docId: init.document.id, sha256: declaredButWrongSha }),
    ).rejects.toThrow(/sha_mismatch/);

    const after = await admin.documents.get(init.document.id);
    expect(after.state).toBe('failed');
    expect(after.failureReason).toBe('sha_mismatch');
  });

  test('tenant isolation: tenant B cannot read or delete tenant A docs', async () => {
    const adminA = createCloudAdmin({
      baseUrl: fx.baseUrl,
      tenantToken: adminToken('tenant-iso-a'),
    });
    const adminB = createCloudAdmin({
      baseUrl: fx.baseUrl,
      tenantToken: adminToken('tenant-iso-b'),
    });
    const doc = await adminA.documents.create({ bytes: fakePdf(5, 256) });

    // B's listing does not include A's doc.
    const listB = await adminB.documents.list();
    expect(listB.find((d) => d.id === doc.document.id)).toBeUndefined();

    // GET single doc as B -> 403.
    let err: AdminError | undefined;
    try {
      await adminB.documents.get(doc.document.id);
    } catch (e) {
      err = e as AdminError;
    }
    expect(err).toBeInstanceOf(AdminError);
    expect(err!.status).toBe(403);

    // DELETE as B -> 403 (and the doc must still exist for A afterwards).
    let delErr: AdminError | undefined;
    try {
      await adminB.documents.delete(doc.document.id);
    } catch (e) {
      delErr = e as AdminError;
    }
    expect(delErr?.status).toBe(403);
    const stillThere = await adminA.documents.get(doc.document.id);
    expect(stillThere.state).toBe('ready');
  });

  test('cascade delete removes DB row + storage bytes', async () => {
    const admin = createCloudAdmin({
      baseUrl: fx.baseUrl,
      tenantToken: adminToken('tenant-del'),
    });
    const doc = await admin.documents.create({ bytes: fakePdf(6, 1500) });
    const key = StorageKeys.basePdf(doc.document.tenantId, doc.document.id);
    expect(await fx.store.stat(key)).not.toBeNull();

    await admin.documents.delete(doc.document.id);
    expect(await fx.store.stat(key)).toBeNull();

    let err: AdminError | undefined;
    try {
      await admin.documents.get(doc.document.id);
    } catch (e) {
      err = e as AdminError;
    }
    expect(err?.status).toBe(404);
  });

  test('non-admin token is rejected by admin routes', async () => {
    const nonAdmin = signDevToken(SECRET, { sub: 'engine-user', tenant_id: 'tenant-x' });
    const admin = createCloudAdmin({ baseUrl: fx.baseUrl, tenantToken: nonAdmin });
    let err: AdminError | undefined;
    try {
      await admin.documents.list();
    } catch (e) {
      err = e as AdminError;
    }
    expect(err?.status).toBe(403);
  });

  test('docs.read scope alone cannot create', async () => {
    const readOnly = signDevToken(SECRET, {
      sub: 'reader',
      tenant_id: 'tenant-ro',
      admin_scope: ['docs.read'],
    });
    const admin = createCloudAdmin({ baseUrl: fx.baseUrl, tenantToken: readOnly });

    // List works.
    const list = await admin.documents.list();
    expect(Array.isArray(list)).toBe(true);

    // Create fails.
    let err: AdminError | undefined;
    try {
      await admin.documents.create({ bytes: fakePdf(7, 64) });
    } catch (e) {
      err = e as AdminError;
    }
    expect(err?.status).toBe(403);
  });
});

describe('Admin documents E2E - sweeper', () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await buildFixture({ sweepIntervalMs: 50 });
  });
  afterAll(async () => {
    await tearDown(fx);
  });

  test('stale pending docs are reaped by the background sweeper', async () => {
    const admin = createCloudAdmin({
      baseUrl: fx.baseUrl,
      tenantToken: adminToken('tenant-sweep'),
    });
    const bytes = fakePdf(9, 4096);

    // init but never upload+commit -> stays pending.
    const init = await admin.documents.init({
      contentLength: bytes.byteLength,
      contentSha256: sha256Hex(bytes),
    });
    if (init.tag === 'deduped') throw new Error('unexpected dedup');
    expect(init.document.state).toBe('pending');

    // Wait long enough for the sweeper to run twice past the TTL.
    await new Promise((r) => setTimeout(r, 400));

    let err: AdminError | undefined;
    try {
      await admin.documents.get(init.document.id);
    } catch (e) {
      err = e as AdminError;
    }
    expect(err?.status).toBe(404);
  });
});
