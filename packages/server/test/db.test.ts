import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type Kysely } from 'kysely';
import { createSqliteDb } from '../src/db/drivers/sqlite';
import { migrate } from '../src/db/migrator/runner';
import { sqliteMigrations } from '../src/db/migrations/sqlite/index';
import { DocumentsRepo } from '../src/db/repos/documents.repo';
import { TenantsRepo } from '../src/db/repos/tenants.repo';
import type { Database } from '../src/db/schema';

async function freshDb(): Promise<Kysely<Database>> {
  const db = createSqliteDb({ path: ':memory:' });
  await migrate(db, { source: { kind: 'inline', migrations: sqliteMigrations } });
  return db;
}

describe('migrator', () => {
  test('applies pending migrations and records checksums', async () => {
    const db = createSqliteDb({ path: ':memory:' });
    const applied = await migrate(db, {
      source: { kind: 'inline', migrations: sqliteMigrations },
    });
    expect(applied.length).toBe(sqliteMigrations.length);

    const rows = await db.selectFrom('schema_migrations').selectAll().execute();
    expect(rows).toHaveLength(sqliteMigrations.length);
    expect(rows[0]!.version).toBe('001');
    expect(rows[0]!.checksum.length).toBe(64);
    await db.destroy();
  });

  test('re-running migrate is a no-op once everything applied', async () => {
    const db = createSqliteDb({ path: ':memory:' });
    await migrate(db, { source: { kind: 'inline', migrations: sqliteMigrations } });
    const second = await migrate(db, {
      source: { kind: 'inline', migrations: sqliteMigrations },
    });
    expect(second).toHaveLength(0);
    await db.destroy();
  });

  test('rejects rename of an already-applied migration', async () => {
    const db = createSqliteDb({ path: ':memory:' });
    await migrate(db, { source: { kind: 'inline', migrations: sqliteMigrations } });
    await expect(
      migrate(db, {
        source: {
          kind: 'inline',
          migrations: [{ version: '001', name: '001_renamed.sql', sql: 'SELECT 1;' }],
        },
      }),
    ).rejects.toThrow(/renamed/);
    await db.destroy();
  });
});

describe('TenantsRepo', () => {
  let db: Kysely<Database>;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  test('ensure is idempotent and returns the existing row', async () => {
    const repo = new TenantsRepo(db);
    const a = await repo.ensure({ id: 'tenant-1', name: 'Acme' });
    const b = await repo.ensure({ id: 'tenant-1', name: 'Different name ignored' });
    expect(a.id).toBe('tenant-1');
    expect(a.name).toBe('Acme');
    expect(b.name).toBe('Acme');
  });
});

describe('DocumentsRepo', () => {
  let db: Kysely<Database>;
  let docs: DocumentsRepo;
  let tenants: TenantsRepo;

  beforeEach(async () => {
    db = await freshDb();
    tenants = new TenantsRepo(db);
    docs = new DocumentsRepo(db);
    await tenants.ensure({ id: 'tenant-a' });
    await tenants.ensure({ id: 'tenant-b' });
  });
  afterEach(async () => {
    await db.destroy();
  });

  test('createPending returns a pending row', async () => {
    const r = await docs.createPending({
      id: 'doc12345',
      tenantId: 'tenant-a',
      metadata: { name: 'Q1' },
      idempotencyKey: null,
      createdBy: 'admin-1',
    });
    expect(r.created).toBe(true);
    expect(r.row.state).toBe('pending');
    expect(r.row.metadata).toEqual({ name: 'Q1' });
    expect(r.row.createdBy).toBe('admin-1');
  });

  test('idempotency-key returns the existing row on retry', async () => {
    const first = await docs.createPending({
      id: 'doc12345',
      tenantId: 'tenant-a',
      metadata: null,
      idempotencyKey: 'kx-1',
      createdBy: null,
    });
    const second = await docs.createPending({
      id: 'doc99999', // different docId; idempotency overrides
      tenantId: 'tenant-a',
      metadata: null,
      idempotencyKey: 'kx-1',
      createdBy: null,
    });
    expect(second.created).toBe(false);
    expect(second.row.id).toBe(first.row.id);
  });

  test('idempotency-key is scoped per-tenant', async () => {
    await docs.createPending({
      id: 'doc12345',
      tenantId: 'tenant-a',
      metadata: null,
      idempotencyKey: 'kx-1',
      createdBy: null,
    });
    const other = await docs.createPending({
      id: 'doc23456',
      tenantId: 'tenant-b',
      metadata: null,
      idempotencyKey: 'kx-1',
      createdBy: null,
    });
    expect(other.created).toBe(true);
    expect(other.row.id).toBe('doc23456');
  });

  test('commit promotes pending -> ready exactly once', async () => {
    await docs.createPending({
      id: 'doc12345',
      tenantId: 'tenant-a',
      metadata: null,
      idempotencyKey: null,
      createdBy: null,
    });
    const updated = await docs.commit({
      id: 'doc12345',
      tenantId: 'tenant-a',
      baseSha: 'a'.repeat(64),
      storageSizeBytes: 1024,
      pageCount: 7,
    });
    expect(updated?.state).toBe('ready');
    expect(updated?.baseSha).toBe('a'.repeat(64));
    expect(updated?.pageCount).toBe(7);

    const second = await docs.commit({
      id: 'doc12345',
      tenantId: 'tenant-a',
      baseSha: 'a'.repeat(64),
      storageSizeBytes: 1024,
      pageCount: 7,
    });
    expect(second).toBeNull();
  });

  test('requireOwned rejects cross-tenant reads', async () => {
    await docs.createPending({
      id: 'doc12345',
      tenantId: 'tenant-a',
      metadata: null,
      idempotencyKey: null,
      createdBy: null,
    });
    await expect(docs.requireOwned('doc12345', 'tenant-b')).rejects.toThrow(/tenant/);
    await expect(docs.requireOwned('nope', 'tenant-a')).rejects.toThrow(/not found/);
  });

  test('beginDelete + finalizeDelete are idempotent', async () => {
    await docs.createPending({
      id: 'doc12345',
      tenantId: 'tenant-a',
      metadata: null,
      idempotencyKey: null,
      createdBy: null,
    });
    expect((await docs.beginDelete('doc12345', 'tenant-a'))?.state).toBe('deleting');
    expect(await docs.beginDelete('doc12345', 'tenant-a')).toBeNull();
    await docs.finalizeDelete('doc12345', 'tenant-a');
    expect(await docs.findById('doc12345')).toBeNull();
  });

  test('listStalePending only returns rows older than the cutoff', async () => {
    await docs.createPending({
      id: 'doc12345',
      tenantId: 'tenant-a',
      metadata: null,
      idempotencyKey: null,
      createdBy: null,
    });
    expect(await docs.listStalePending(1_000_000)).toHaveLength(0);
    // From the future: every existing row is stale.
    expect(await docs.listStalePending(0, Date.now() + 1_000_000)).toHaveLength(1);
  });

  test('findByBaseSha returns the latest ready doc per tenant', async () => {
    await docs.createPending({
      id: 'doc12345',
      tenantId: 'tenant-a',
      metadata: null,
      idempotencyKey: null,
      createdBy: null,
    });
    await docs.commit({
      id: 'doc12345',
      tenantId: 'tenant-a',
      baseSha: 'b'.repeat(64),
      storageSizeBytes: 1,
      pageCount: 1,
    });
    expect((await docs.findByBaseSha('tenant-a', 'b'.repeat(64)))?.id).toBe('doc12345');
    expect(await docs.findByBaseSha('tenant-a', 'c'.repeat(64))).toBeNull();
    expect(await docs.findByBaseSha('tenant-b', 'b'.repeat(64))).toBeNull();
  });
});
