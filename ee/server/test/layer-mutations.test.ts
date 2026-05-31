import { createHash, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import {
  buildApp,
  createSqliteDb,
  EventLogService,
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
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/annotations/pages/1/items`,
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
      meta: {
        cacheDelta: {
          previousDocVersion: number;
          docVersion: number;
          pages: Array<{
            pageObjectNumber: number;
            cache: {
              annotationVersion: number;
              contentVersion: number;
            };
          }>;
        };
        affectedPages: Array<{ pageObjectNumber: number; revision: { generation: number } }>;
      };
    };
    expect(body.meta.affectedPages[0]?.pageObjectNumber).toBe(1);
    expect(body.meta.affectedPages[0]?.revision.generation).toBe(0);
    expect(body.meta.cacheDelta).toMatchObject({
      previousDocVersion: 1,
      docVersion: 2,
      pages: [{ pageObjectNumber: 1, cache: { annotationVersion: 2, contentVersion: 1 } }],
    });

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

    const auditRows = await fx.db
      .selectFrom('audit_log')
      .selectAll()
      .where('doc_id', '=', docId)
      .execute();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      tenant_id: tenantId,
      doc_id: docId,
      layer_id: layer.id,
      layer_name: layerName,
      sub: 'user-1',
      kind: 'annot.create',
      page_object_number: 1,
      affected_pages_json: '[1]',
      artifact_version: 1,
      artifact_key: layer.current_artifact_key,
      artifact_sha: layer.current_artifact_sha,
      artifact_size: 4,
    });

    const day = new Date(Number(auditRows[0]!.ts)).toISOString().slice(0, 10);
    const eventKey = StorageKeys.eventsDay(tenantId, docId, day);
    expect(await storage.exists(eventKey)).toBe(false);

    const exported = await new EventLogService({ storage }).exportDocDayJsonl(fx.db, {
      tenantId,
      docId,
      day,
      allowOpenDay: true,
    });
    expect(exported).toEqual({ key: eventKey, count: 1, status: 'exported' });

    const exportRow = await fx.db
      .selectFrom('audit_exports')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('doc_id', '=', docId)
      .where('day', '=', day)
      .executeTakeFirstOrThrow();
    expect(exportRow).toMatchObject({
      status: 'succeeded',
      storage_key: eventKey,
      event_count: 1,
      lease_id: null,
      lease_expires_at: null,
    });

    const jsonlEvents = await readJsonlEvents(storage, eventKey);
    expect(jsonlEvents).toHaveLength(1);
    expect(jsonlEvents[0]).toMatchObject({
      id: Number(auditRows[0]!.id),
      tenantId,
      docId,
      layerId: layer.id,
      layerName,
      sub: 'user-1',
      kind: 'annot.create',
      pageObjectNumber: 1,
      affectedPages: [1],
      artifactVersion: 1,
      artifactKey: layer.current_artifact_key,
      artifactSha: layer.current_artifact_sha,
      artifactSize: 4,
    });

    const pages = await fx.db
      .selectFrom('layer_pages')
      .selectAll()
      .where('layer_id', '=', layer.id)
      .orderBy('page_object_number', 'asc')
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

    const stale = await fetch(
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/manifest@docVersion=1`,
      {
        headers: { Authorization: `Bearer ${docToken(tenantId, docId, layerName)}` },
      },
    );
    expect(stale.status).toBe(404);

    const fresh = await fetch(
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/manifest@docVersion=2`,
      {
        headers: { Authorization: `Bearer ${docToken(tenantId, docId, layerName)}` },
      },
    );
    expect(fresh.status).toBe(200);
    const manifest = (await fresh.json()) as {
      pages: Array<{
        state: { pageObjectNumber: number };
        cache: { annotationVersion: number };
      }>;
    };
    expect(
      manifest.pages.find((p) => p.state.pageObjectNumber === 1)?.cache.annotationVersion,
    ).toBe(2);
  });

  test('stable delete creates the next artifact and bumps index generation', async () => {
    const tenantId = 'tenant-layer-del';
    const docId = 'doclayermut002';
    const layerName = 'alice';
    await seedDocument(fx, tenantId, docId, { pageCount: 1 });

    await fetch(`${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/annotations/pages/1/items`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${docToken(tenantId, docId, layerName)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(highlightDraft()),
    });

    const res = await fetch(
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/annotations/pages/1/items/obj%3A10001`,
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
    expect(page.annotation_generation).toBe(1);
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
    await beginWeakAnnotationSession(fx, tenantId, docId, layerName, [1]);

    const res = await fetch(
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/annotations/pages/1/items/index`,
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
        affectedPages: Array<{ revision: { docSessionId: string; generation: number } }>;
      };
    };
    expect(body.meta.weakRefsInvalidated).toBe(true);
    expect(body.meta.shouldRefetch).toEqual({ reason: 'weakRefsInvalidated' });
    expect(body.meta.affectedPages[0]?.revision).toMatchObject({
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

  test('weak page delete requires an active weak annotation session covering the page', async () => {
    const tenantId = 'tenant-layer-weak-required';
    const docId = 'doclayermut006';
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

    const denied = await fetch(
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/annotations/pages/1/items/index`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${docToken(tenantId, docId, layerName)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          op: 'delete',
          ref: cloudIndexRef(docId, layerName, 1, 0, 10),
        }),
      },
    );
    expect(denied.status).toBe(409);

    const session = await beginWeakAnnotationSession(fx, tenantId, docId, layerName, []);
    const stillDenied = await fetch(
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/annotations/pages/1/items/index`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${docToken(tenantId, docId, layerName)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          op: 'delete',
          ref: cloudIndexRef(docId, layerName, 1, 0, 10),
        }),
      },
    );
    expect(stillDenied.status).toBe(409);

    const update = await fetch(
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/weak-annotation-sessions/${session.sessionId}/pages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${docToken(tenantId, docId, layerName)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pageObjectNumbers: [1] }),
      },
    );
    expect(update.status).toBe(200);

    const allowed = await fetch(
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/annotations/pages/1/items/index`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${docToken(tenantId, docId, layerName)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          op: 'delete',
          ref: cloudIndexRef(docId, layerName, 1, 0, 10),
        }),
      },
    );
    expect(allowed.status).toBe(200);
  });

  test('weak page structural edit is blocked when another distinct editor is active', async () => {
    const tenantId = 'tenant-layer-weak-two-editors';
    const docId = 'doclayermut007';
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
    await beginWeakAnnotationSession(fx, tenantId, docId, layerName, [1], 'user-1');
    await beginWeakAnnotationSession(fx, tenantId, docId, layerName, [1], 'user-2');

    const res = await fetch(
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/annotations/pages/1/items/index`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${docToken(tenantId, docId, layerName, 'user-1')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          op: 'delete',
          ref: cloudIndexRef(docId, layerName, 1, 0, 10),
        }),
      },
    );
    expect(res.status).toBe(409);

    const layer = await fx.db
      .selectFrom('layers')
      .selectAll()
      .where('doc_id', '=', docId)
      .where('name', '=', layerName)
      .executeTakeFirstOrThrow();
    expect(layer.current_version).toBe(1);
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
    await beginWeakAnnotationSession(fx, tenantId, docId, layerName, [1]);

    const res = await fetch(
      `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/annotations/pages/1/items/index`,
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

  test('page move saves a layer artifact, bumps layer doc version, and rewrites page order', async () => {
    const tenantId = 'tenant-layer-pages';
    const docId = 'doclayermut005';
    const layerName = 'alice';
    await seedDocument(fx, tenantId, docId, { pageCount: 3 });

    const res = await fetch(`${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/pages/move`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${docToken(tenantId, docId, layerName)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pageObjectNumbers: [3], destIndex: 0 }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
    const body = (await res.json()) as {
      layout: {
        pageCount: number;
        pages: Array<{ pageObjectNumber: number; index: number }>;
      };
      cache: {
        previousDocVersion: number;
        docVersion: number;
        layoutVersion: number;
      } | null;
    };
    // A move returns the new geometry (order), not liveness.
    expect(body.layout.pageCount).toBe(3);
    expect(body.layout.pages.map((page) => page.pageObjectNumber)).toEqual([3, 1, 2]);
    expect(body.layout.pages.map((page) => page.index)).toEqual([0, 1, 2]);
    // Cloud coherence pins: docVersion + layoutVersion both advance by one,
    // no per-page pin changes.
    expect(body.cache).toEqual({ previousDocVersion: 1, docVersion: 2, layoutVersion: 2 });

    const layer = await fx.db
      .selectFrom('layers')
      .selectAll()
      .where('doc_id', '=', docId)
      .where('name', '=', layerName)
      .executeTakeFirstOrThrow();
    expect(layer.current_version).toBe(1);
    expect(layer.doc_version).toBe(2);
    expect(Number(layer.layout_version)).toBe(2);
    expect(layer.current_artifact_key).toBe(
      StorageKeys.layerArtifact(tenantId, docId, layerName, 1),
    );

    // `layer_pages` rows are untouched by a move (display order lives in the
    // artifact/layout, not the table). Assert the page set + pins survive.
    const pages = await fx.db
      .selectFrom('layer_pages')
      .select(['page_object_number', 'annotation_version', 'annotation_generation'])
      .where('layer_id', '=', layer.id)
      .orderBy('page_object_number', 'asc')
      .execute();
    expect(pages.map((page) => Number(page.page_object_number))).toEqual([1, 2, 3]);
    expect(pages.map((page) => Number(page.annotation_version))).toEqual([1, 1, 1]);
    expect(pages.map((page) => Number(page.annotation_generation))).toEqual([0, 0, 0]);
  });
});

async function buildFixture(): Promise<Fixture> {
  const storageRoot = await mkdtemp(join(tmpdir(), 'layer-mutations-store-'));
  const cacheRoot = await mkdtemp(join(tmpdir(), 'layer-mutations-cache-'));
  const db = createSqliteDb({ path: ':memory:' });
  await migrate(db, { source: { kind: 'inline', migrations: sqliteMigrations } });
  const store = new FsObjectStore({ root: storageRoot });
  const bundle = await buildApp({
    verifier: { mode: 'hs256', secret: SECRET },
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

function docToken(tenantId: string, docId: string, layerName: string, sub = 'user-1'): string {
  return signDevToken(SECRET, {
    sub,
    tenant_id: tenantId,
    doc_id: docId,
    layer_name: layerName,
    scope: ['*'],
  });
}

async function beginWeakAnnotationSession(
  fx: Fixture,
  tenantId: string,
  docId: string,
  layerName: string,
  pageObjectNumbers: number[],
  sub = 'user-1',
): Promise<{ sessionId: string; pageObjectNumbers: number[] }> {
  const res = await fetch(
    `${fx.baseUrl}/v1/docs/${docId}/layers/${layerName}/weak-annotation-sessions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${docToken(tenantId, docId, layerName, sub)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pageObjectNumbers }),
    },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { sessionId: string; pageObjectNumbers: number[] };
}

function cloudIndexRef(
  docId: string,
  layerName: string,
  pageObjectNumber: number,
  index: number,
  generation: number,
): unknown {
  return {
    kind: 'index',
    pageObjectNumber,
    index,
    revision: {
      docSessionId: `cloud:layer:${docId}:${layerName}`,
      pageObjectNumber,
      generation,
    },
  };
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

async function readJsonlEvents(
  storage: FsObjectStore,
  key: string,
): Promise<Array<Record<string, unknown>>> {
  const bytes = await storage.get(key);
  if (!bytes) return [];
  return Buffer.from(bytes)
    .toString('utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
