import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { FsObjectStore } from '../src/storage/adapters/FsObjectStore';
import { StorageKeys } from '../src/storage/keys';

describe('StorageKeys', () => {
  test('basePdf composes per-doc 2-char shard layout', () => {
    expect(StorageKeys.basePdf('tnt-1', 'ab123')).toBe('tnt-1/docs/ab/ab123/base.pdf');
  });
  test('docRoot ends with /', () => {
    expect(StorageKeys.docRoot('t', 'ab123')).toBe('t/docs/ab/ab123/');
  });
  test('layerPdf zero-pads version', () => {
    expect(StorageKeys.layerPdf('t', 'ab123', 'main', 7)).toBe(
      't/docs/ab/ab123/layers/main/v0007.pdf',
    );
  });
  test('eventsMonth validates YYYY-MM', () => {
    expect(StorageKeys.eventsMonth('t', 'ab123', '2026-05')).toBe(
      't/docs/ab/ab123/events/2026-05.jsonl',
    );
    expect(() => StorageKeys.eventsMonth('t', 'ab123', '2026-5')).toThrow();
  });
  test('rejects too-short docIds', () => {
    expect(() => StorageKeys.basePdf('t', 'a')).toThrow();
  });
  test('uses lowercase shard so case-folded filesystems behave', () => {
    expect(StorageKeys.basePdf('t', 'AB123')).toBe('t/docs/ab/AB123/base.pdf');
  });
});

describe('FsObjectStore', () => {
  let root: string;
  let store: FsObjectStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'embedpdf-fs-store-'));
    store = new FsObjectStore({ root });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('put + get + stat roundtrip', async () => {
    const bytes = randomBytes(2048);
    const key = StorageKeys.basePdf('tenant-a', 'doc12345');
    const { sha256 } = await store.put(key, bytes, { contentLength: bytes.byteLength });
    expect(sha256).toBe(sha256Hex(bytes));

    const got = await store.get(key);
    expect(got).not.toBeNull();
    expect(got!.byteLength).toBe(bytes.byteLength);
    expect(sha256Hex(got!)).toBe(sha256);

    const s = await store.stat(key);
    expect(s).not.toBeNull();
    expect(s!.size).toBe(bytes.byteLength);
  });

  test('put rejects content-length mismatch and leaves no .partial', async () => {
    const bytes = randomBytes(256);
    const key = StorageKeys.basePdf('t', 'doc12345');
    await expect(store.put(key, bytes, { contentLength: bytes.byteLength + 10 })).rejects.toThrow(
      /contentLength/,
    );
    const stat = await store.stat(key);
    expect(stat).toBeNull();
  });

  test('getSha256 matches put result and survives unrelated reads', async () => {
    const bytes = randomBytes(512);
    const key = StorageKeys.basePdf('t', 'doc12345');
    const { sha256 } = await store.put(key, bytes, { contentLength: bytes.byteLength });
    expect(await store.getSha256(key)).toBe(sha256);
    expect(await store.getSha256('missing/key')).toBeNull();
  });

  test('delete is idempotent and tidies empty ancestor dirs', async () => {
    const bytes = randomBytes(128);
    const key = StorageKeys.basePdf('t', 'doc12345');
    await store.put(key, bytes, { contentLength: bytes.byteLength });
    expect(await store.delete(key)).toBe(true);
    expect(await store.delete(key)).toBe(false); // already gone
    expect(await store.stat(key)).toBeNull();
  });

  test('deletePrefix recursively removes everything under a doc', async () => {
    const tenant = 'tenant-a';
    const docId = 'doc12345';
    const base = StorageKeys.basePdf(tenant, docId);
    const layer = StorageKeys.layerPdf(tenant, docId, 'main', 1);
    const events = StorageKeys.eventsMonth(tenant, docId, '2026-05');

    await store.put(base, new Uint8Array([1]), { contentLength: 1 });
    await store.put(layer, new Uint8Array([2, 3]), { contentLength: 2 });
    await store.put(events, new Uint8Array([4, 5, 6]), { contentLength: 3 });

    const prefix = StorageKeys.docRoot(tenant, docId);
    const { deleted } = await store.deletePrefix(prefix);
    expect(deleted).toBe(3);
    expect(await store.stat(base)).toBeNull();
    expect(await store.stat(layer)).toBeNull();
    expect(await store.stat(events)).toBeNull();
  });

  test('deletePrefix on a missing prefix is a no-op', async () => {
    const { deleted } = await store.deletePrefix('nope/');
    expect(deleted).toBe(0);
  });

  test('absolute(...) rejects traversal attempts', async () => {
    await expect(
      store.put('../../etc/passwd', new Uint8Array([0]), { contentLength: 1 }),
    ).rejects.toThrow(/invalid|escapes/);
    await expect(
      store.put('/etc/passwd', new Uint8Array([0]), { contentLength: 1 }),
    ).rejects.toThrow(/invalid|escapes/);
  });

  test('presign methods return null (FS has no presign concept)', async () => {
    expect(
      await store.presignUpload('any/key', 60, {
        contentLength: 0,
        contentType: 'application/pdf',
      }),
    ).toBeNull();
    expect(await store.presignDownload('any/key', 60)).toBeNull();
  });
});

function randomBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) arr[i] = (i * 31 + 7) & 0xff;
  return arr;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
