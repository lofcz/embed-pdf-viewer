import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { sdkStreamMixin } from '@smithy/util-stream';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { S3ObjectStore } from '../src/storage/adapters/S3ObjectStore';
import { StorageKeys } from '../src/storage/keys';

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
});
afterEach(() => {
  s3Mock.reset();
});

describe('S3ObjectStore', () => {
  test('put records SHA-256 in object metadata for verify-on-commit', async () => {
    const store = new S3ObjectStore({
      bucket: 'b',
      region: 'us-east-1',
      client: new S3Client({ region: 'us-east-1' }),
    });
    const bytes = randomBytes(512);
    const sha = sha256Hex(bytes);
    s3Mock.on(PutObjectCommand).resolves({});

    const r = await store.put('tenant/docs/ab/abx/base.pdf', bytes, {
      contentLength: bytes.byteLength,
    });
    expect(r.sha256).toBe(sha);
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.args[0].input;
    expect(input.Bucket).toBe('b');
    expect(input.Key).toBe('tenant/docs/ab/abx/base.pdf');
    expect(input.ContentLength).toBe(bytes.byteLength);
    expect(input.ContentType).toBe('application/pdf');
    expect(input.Metadata).toEqual({ 'x-embedpdf-sha256': sha });
  });

  test('put rejects content-length mismatch without making an S3 call', async () => {
    const store = newStore();
    const bytes = randomBytes(64);
    s3Mock.on(PutObjectCommand).resolves({});
    await expect(store.put('k', bytes, { contentLength: bytes.byteLength - 1 })).rejects.toThrow(
      /contentLength/,
    );
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  test('getSha256 prefers the x-embedpdf-sha256 metadata header (no body read)', async () => {
    const store = newStore();
    const sha = 'a'.repeat(64);
    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 1024,
      ETag: '"abc"',
      Metadata: { 'x-embedpdf-sha256': sha },
    });
    expect(await store.getSha256('k')).toBe(sha);
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  test('getSha256 falls back to body read when metadata is missing', async () => {
    const store = newStore();
    const bytes = randomBytes(256);
    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: bytes.byteLength,
      ETag: '"abc"',
      Metadata: {},
    });
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from([Buffer.from(bytes)])),
    });
    expect(await store.getSha256('k')).toBe(sha256Hex(bytes));
  });

  test('stat reads size + etag and returns null on 404', async () => {
    const store = newStore();
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 8, ETag: '"xyz"' });
    expect(await store.stat('k')).toEqual({ size: 8, etag: 'xyz' });
    s3Mock.reset();
    s3Mock.on(HeadObjectCommand).rejects(makeNotFound());
    expect(await store.stat('missing')).toBeNull();
  });

  test('get streams the body into a Uint8Array; missing key -> null', async () => {
    const store = newStore();
    const bytes = randomBytes(128);
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from([Buffer.from(bytes)])),
    });
    const got = await store.get('k');
    expect(got?.byteLength).toBe(bytes.byteLength);
    expect(sha256Hex(got!)).toBe(sha256Hex(bytes));

    s3Mock.reset();
    s3Mock.on(GetObjectCommand).rejects(makeNotFound());
    expect(await store.get('missing')).toBeNull();
  });

  test('presignUpload returns a signed URL and the required PUT headers', async () => {
    const store = newStore();
    const presigned = await store.presignUpload('tenant/docs/ab/abx/base.pdf', 60, {
      contentLength: 100,
      contentType: 'application/pdf',
    });
    expect(presigned).not.toBeNull();
    expect(presigned!.method).toBe('PUT');
    // S3 SDK v3 issues path-style or virtual-host URLs; either is fine
    // as long as the bucket + key + signing query params are present.
    expect(presigned!.url).toMatch(/amazonaws\.com\/.+tenant\/docs\/ab\/abx\/base\.pdf\?/);
    expect(presigned!.url).toContain('X-Amz-Signature');
    expect(presigned!.headers).toMatchObject({
      'Content-Type': 'application/pdf',
      'Content-Length': '100',
    });
    expect(presigned!.expiresAt).toBeGreaterThan(Date.now());
  });

  test('deletePrefix pages through ListObjectsV2 and DeleteObjects', async () => {
    const store = newStore();
    s3Mock.on(ListObjectsV2Command).resolvesOnce({
      Contents: [{ Key: 'p/a' }, { Key: 'p/b' }],
      IsTruncated: true,
      NextContinuationToken: 'tok-1',
    });
    s3Mock.on(ListObjectsV2Command, { ContinuationToken: 'tok-1' }).resolves({
      Contents: [{ Key: 'p/c' }],
      IsTruncated: false,
    });
    s3Mock.on(DeleteObjectsCommand).resolves({});
    const { deleted } = await store.deletePrefix('p/');
    expect(deleted).toBe(3);
    expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(2);
  });

  test('delete is idempotent against 404', async () => {
    const store = newStore();
    s3Mock.on(DeleteObjectCommand).resolves({});
    expect(await store.delete('k')).toBe(true);
    s3Mock.reset();
    s3Mock.on(DeleteObjectCommand).rejects(makeNotFound());
    expect(await store.delete('k')).toBe(false);
  });

  test('keys derived from StorageKeys make round-trip plausible', async () => {
    const store = newStore();
    const key = StorageKeys.basePdf('tnt', 'abxxxxx');
    expect(key).toBe('tnt/docs/ab/abxxxxx/base.pdf');
    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 0,
      ETag: '""',
      Metadata: { 'x-embedpdf-sha256': 'f'.repeat(64) },
    });
    expect(await store.getSha256(key)).toBe('f'.repeat(64));
  });
});

function newStore(): S3ObjectStore {
  return new S3ObjectStore({
    bucket: 'b',
    region: 'us-east-1',
    client: new S3Client({
      region: 'us-east-1',
      credentials: { accessKeyId: 'AKIA-TEST', secretAccessKey: 'SECRET' },
    }),
  });
}

function randomBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) arr[i] = (i * 41 + 13) & 0xff;
  return arr;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function makeNotFound(): Error & { name: string; $metadata: { httpStatusCode: number } } {
  const err = new Error('not found') as Error & {
    name: string;
    $metadata: { httpStatusCode: number };
  };
  err.name = 'NotFound';
  err.$metadata = { httpStatusCode: 404 };
  return err;
}
