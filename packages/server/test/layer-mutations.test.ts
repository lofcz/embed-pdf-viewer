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
const SECRET = 'layer-mutations-secret';
const NO_STORE = 'private, no-store';

interface Fixture {
  bundle: AppBundle;
  app: FastifyInstance;
  db: Kysely<DbSchema>;
  baseUrl: string;
  storageRoot: string;
  cacheRoot: string;
}

describe('Phase 5 layer mutation pipeline', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await buildFixture();
  });

  afterEach(async () => {
    await tearDown(fx);
  });

  test('first annotation create lazily creates layer, saves artifact, and bumps annotation version', async () => {
    const tenantId = 'tenant-layer-mut';
    const docId = 'doclayermut001';
    const layerName = 'alice';
    await seedDocument(fx, tenantId, docId, { pageCount: 2 });

    const res = await fetch(
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/pages/1/annotations`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${docToken(tenantId, docId, layerName)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(highlightDraft()),
      },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
    const body = (await res.json()) as {
      meta: { pageState: { pageObjectNumber: number; revision: { generation: number } } };
    };
    expect(body.meta.pageState.pageObjectNumber).toBe(1);
    expect(body.meta.pageState.revision.generation).toBe(0);

    const layer = await fx.db
      .selectFrom('layers')
      .selectAll()
      .where('doc_id', '=', docId)
      .where('name', '=', layerName)
      .executeTakeFirstOrThrow();
    expect(layer.current_version).toBe(1);
    expect(layer.doc_version).toBe(2);
    expect(layer.current_artifact_key).toBe(
      StorageKeys.layerArtifact(tenantId, docId, layerName, 1),
    );
    expect(layer.current_artifact_size).toBe(4);

    const storage = new FsObjectStore({ root: fx.storageRoot });
    expect(await storage.exists(layer.current_artifact_key!)).toBe(true);

    const pages = await fx.db
      .selectFrom('layer_pages')
      .selectAll()
      .where('layer_id', '=', layer.id)
      .orderBy('page_index', 'asc')
      .execute();
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({
      page_object_number: 1,
      annotation_version: 2,
      annotation_generation: 0,
    });
    expect(pages[1]).toMatchObject({
      page_object_number: 2,
      annotation_version: 1,
      annotation_generation: 0,
    });

    const stale = await fetch(`${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/v1/manifest`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId, layerName)}` },
    });
    expect(stale.status).toBe(404);

    const fresh = await fetch(`${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/v2/manifest`, {
      headers: { Authorization: `Bearer ${docToken(tenantId, docId, layerName)}` },
    });
    expect(fresh.status).toBe(200);
    const manifest = (await fresh.json()) as {
      pages: Array<{ pageObjectNumber: number; annotationVersion: number }>;
    };
    expect(manifest.pages.find((p) => p.pageObjectNumber === 1)?.annotationVersion).toBe(2);
  });

  test('stable delete creates the next artifact without bumping weak-index generation', async () => {
    const tenantId = 'tenant-layer-del';
    const docId = 'doclayermut002';
    const layerName = 'alice';
    await seedDocument(fx, tenantId, docId, { pageCount: 1 });

    await fetch(`${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/pages/1/annotations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${docToken(tenantId, docId, layerName)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(highlightDraft()),
    });

    const res = await fetch(
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/pages/1/annotations/obj%3A10001`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${docToken(tenantId, docId, layerName)}` },
      },
    );
    expect(res.status).toBe(200);

    const layer = await fx.db
      .selectFrom('layers')
      .selectAll()
      .where('doc_id', '=', docId)
      .where('name', '=', layerName)
      .executeTakeFirstOrThrow();
    expect(layer.current_version).toBe(2);
    expect(layer.doc_version).toBe(3);
    expect(layer.current_artifact_key).toBe(
      StorageKeys.layerArtifact(tenantId, docId, layerName, 2),
    );

    const page = await fx.db
      .selectFrom('layer_pages')
      .selectAll()
      .where('layer_id', '=', layer.id)
      .where('page_object_number', '=', 1)
      .executeTakeFirstOrThrow();
    expect(page.annotation_version).toBe(3);
    expect(page.annotation_generation).toBe(0);
  });

  test('fresh cloud index delete bridges to worker epoch and bumps generation from DB state', async () => {
    const tenantId = 'tenant-layer-idx';
    const docId = 'doclayermut003';
    const layerName = 'alice';
    await seedDocument(fx, tenantId, docId, { pageCount: 1 });
    await seedLayerPage(fx, {
      tenantId,
      docId,
      layerName,
      annotationVersion: 17,
      annotationGeneration: 10,
      hasWeakAnnotations: true,
    });

    const res = await fetch(
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/pages/1/annotations/index`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${docToken(tenantId, docId, layerName)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          op: 'delete',
          ref: {
            kind: 'index',
            pageObjectNumber: 1,
            index: 0,
            revision: {
              docSessionId: `cloud:layer:${docId}:${layerName}`,
              pageObjectNumber: 1,
              generation: 10,
            },
          },
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      meta: {
        weakRefsInvalidated: boolean;
        shouldRefetch: { reason: string } | null;
        pageState: { revision: { docSessionId: string; generation: number } };
      };
    };
    expect(body.meta.weakRefsInvalidated).toBe(true);
    expect(body.meta.shouldRefetch).toEqual({ reason: 'weakRefsInvalidated' });
    expect(body.meta.pageState.revision).toMatchObject({
      docSessionId: `cloud:layer:${docId}:${layerName}`,
      generation: 11,
    });

    const layer = await fx.db
      .selectFrom('layers')
      .selectAll()
      .where('doc_id', '=', docId)
      .where('name', '=', layerName)
      .executeTakeFirstOrThrow();
    expect(layer.current_version).toBe(2);
    expect(layer.doc_version).toBe(2);

    const page = await fx.db
      .selectFrom('layer_pages')
      .selectAll()
      .where('layer_id', '=', layer.id)
      .where('page_object_number', '=', 1)
      .executeTakeFirstOrThrow();
    expect(page.annotation_version).toBe(18);
    expect(page.annotation_generation).toBe(11);
  });

  test('stale cloud index ref fails before saving a new artifact', async () => {
    const tenantId = 'tenant-layer-stale';
    const docId = 'doclayermut004';
    const layerName = 'alice';
    await seedDocument(fx, tenantId, docId, { pageCount: 1 });
    await seedLayerPage(fx, {
      tenantId,
      docId,
      layerName,
      annotationVersion: 17,
      annotationGeneration: 10,
      hasWeakAnnotations: true,
    });

    const res = await fetch(
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/pages/1/annotations/index`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${docToken(tenantId, docId, layerName)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          op: 'delete',
          ref: {
            kind: 'index',
            pageObjectNumber: 1,
            index: 0,
            revision: {
              docSessionId: `cloud:layer:${docId}:${layerName}`,
              pageObjectNumber: 1,
              generation: 9,
            },
          },
        }),
      },
    );
    expect(res.status).toBe(400);

    const layer = await fx.db
      .selectFrom('layers')
      .selectAll()
      .where('doc_id', '=', docId)
      .where('name', '=', layerName)
      .executeTakeFirstOrThrow();
    expect(layer.current_version).toBe(1);
    expect(layer.doc_version).toBe(1);
  });
});

async function buildFixture(): Promise<Fixture> {
  const storageRoot = await mkdtemp(join(tmpdir(), 'layer-mutations-store-'));
  const cacheRoot = await mkdtemp(join(tmpdir(), 'layer-mutations-cache-'));
  const db = createSqliteDb({ path: ':memory:' });
  await migrate(db, { source: { kind: 'inline', migrations: sqliteMigrations } });
  const store = new FsObjectStore({ root: storageRoot });
  const bundle = await buildApp({
    jwtSecret: SECRET,
    workerEntry: STUB_ENTRY,
    poolSize: 1,
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

function docToken(tenantId: string, docId: string, layerName: string): string {
  return signDevToken(SECRET, {
    sub: 'user-1',
    tenant_id: tenantId,
    doc_id: docId,
    layer_name: layerName,
    scope: ['doc.read', 'doc.annotate'],
  });
}

async function seedDocument(
  fx: Fixture,
  tenantId: string,
  docId: string,
  opts: { pageCount: number },
): Promise<void> {
  const bytes = new Uint8Array(4096);
  bytes[0] = opts.pageCount;
  bytes.set(randomBytes(4095), 1);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const storage = new FsObjectStore({ root: fx.storageRoot });
  await storage.put(StorageKeys.basePdf(tenantId, docId), bytes, {
    contentLength: bytes.byteLength,
  });
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
      page_count: opts.pageCount,
      metadata_json: null,
      idempotency_key: null,
      failure_reason: null,
      created_at: now,
      updated_at: now,
      created_by: null,
    })
    .execute();
}

async function seedLayerPage(
  fx: Fixture,
  input: {
    tenantId: string;
    docId: string;
    layerName: string;
    annotationVersion: number;
    annotationGeneration: number;
    hasWeakAnnotations: boolean;
  },
): Promise<void> {
  const storage = new FsObjectStore({ root: fx.storageRoot });
  const artifactKey = StorageKeys.layerArtifact(input.tenantId, input.docId, input.layerName, 1);
  await storage.put(artifactKey, new Uint8Array([0x4c, 0x01, 0x00, 0x00]), {
    contentLength: 4,
  });
  const now = Date.now();
  await fx.db
    .insertInto('layers')
    .values({
      id: `layer-${input.docId}`,
      doc_id: input.docId,
      tenant_id: input.tenantId,
      name: input.layerName,
      doc_version: 1,
      current_version: 1,
      current_artifact_key: artifactKey,
      current_artifact_sha: createHash('sha256')
        .update(new Uint8Array([0x4c, 0x01, 0x00, 0x00]))
        .digest('hex'),
      current_artifact_size: 4,
      created_at: now,
      updated_at: now,
    })
    .execute();
  await fx.db
    .insertInto('layer_pages')
    .values({
      layer_id: `layer-${input.docId}`,
      page_object_number: 1,
      page_index: 0,
      content_version: 1,
      annotation_version: input.annotationVersion,
      annotation_generation: input.annotationGeneration,
      has_weak_annotations: input.hasWeakAnnotations ? 1 : 0,
      updated_at: now,
    })
    .execute();
}

function highlightDraft(): unknown {
  return {
    subtype: 'highlight',
    quadPoints: [
      {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 10, y: 0 },
        bottomLeft: { x: 0, y: 10 },
        bottomRight: { x: 10, y: 10 },
      },
    ],
  };
}
