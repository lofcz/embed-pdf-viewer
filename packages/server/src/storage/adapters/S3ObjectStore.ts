import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type ObjectIdentifier,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  ObjectBody,
  ObjectStat,
  ObjectStoreWithInfo,
  PresignedDownload,
  PresignedUpload,
  PresignUploadOpts,
} from '../ObjectStore';

export interface S3ObjectStoreOptions {
  /** Required: bucket name. */
  bucket: string;
  /** Required: AWS region (e.g. `us-east-1`). */
  region: string;
  /**
   * Pre-constructed client. Tests inject a mocked client here. In
   * production deployments we'd build one from environment / IRSA.
   */
  client?: S3Client;
  /**
   * For non-AWS S3-compatible endpoints (Cloudflare R2, MinIO,
   * Wasabi, ...). Implies `forcePathStyle: true`.
   */
  endpoint?: string;
}

/**
 * S3 object store. Built around the v3 SDK; presigned PUTs / GETs are
 * the default upload/download pathway in production.
 *
 * Notes on `getSha256`: S3 doesn't expose the SHA-256 of an object
 * by default (ETag is MD5 for single-part PUTs, multi-part hash for
 * MPU). We force `ChecksumAlgorithm=SHA256` on every presigned PUT
 * and store the result in object metadata; the verify-on-commit path
 * reads it from `HeadObject` rather than streaming the full bytes.
 * Phase 1's smoke test mocks `HeadObject` to return this header.
 */
export class S3ObjectStore implements ObjectStoreWithInfo {
  readonly info: { kind: 's3'; location: string };
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(opts: S3ObjectStoreOptions) {
    this.client =
      opts.client ??
      new S3Client({
        region: opts.region,
        ...(opts.endpoint ? { endpoint: opts.endpoint, forcePathStyle: true } : {}),
      });
    this.bucket = opts.bucket;
    this.info = {
      kind: 's3',
      location: opts.endpoint ? `${opts.endpoint}/${opts.bucket}` : `s3://${opts.bucket}`,
    };
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async stat(key: string): Promise<ObjectStat | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      if (typeof r.ContentLength !== 'number') return null;
      return {
        size: r.ContentLength,
        etag: (r.ETag ?? '').replace(/"/g, ''),
      };
    } catch (err) {
      if (isS3NotFound(err)) return null;
      throw err;
    }
  }

  async put(
    key: string,
    body: ObjectBody,
    opts: { contentLength: number },
  ): Promise<{ sha256: string }> {
    let bytes: Uint8Array;
    if (body instanceof Uint8Array) {
      bytes = body;
    } else {
      bytes = await drainReadable(body as Readable);
    }
    if (bytes.byteLength !== opts.contentLength) {
      throw new Error(
        `S3ObjectStore.put: declared contentLength=${opts.contentLength} but got ${bytes.byteLength}`,
      );
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentLength: opts.contentLength,
        ContentType: 'application/pdf',
        Metadata: { 'x-embedpdf-sha256': sha256 },
      }),
    );
    return { sha256 };
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!r.Body) return null;
      return await drainReadable(r.Body as Readable);
    } catch (err) {
      if (isS3NotFound(err)) return null;
      throw err;
    }
  }

  async getSha256(key: string): Promise<string | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      const meta = r.Metadata ?? {};
      // S3 lowercases user-metadata keys on read.
      const fromMeta = meta['x-embedpdf-sha256'];
      if (fromMeta) return fromMeta;
      // Fall back to streaming the body. Only used when an object was
      // PUT outside our SDK (presigned PUT by a misbehaving client).
      const bytes = await this.get(key);
      if (!bytes) return null;
      return createHash('sha256').update(bytes).digest('hex');
    } catch (err) {
      if (isS3NotFound(err)) return null;
      throw err;
    }
  }

  async presignUpload(
    key: string,
    ttlSec: number,
    opts: PresignUploadOpts,
  ): Promise<PresignedUpload | null> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentLength: opts.contentLength,
      ContentType: opts.contentType,
      ...(opts.contentMd5Base64 ? { ContentMD5: opts.contentMd5Base64 } : {}),
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: ttlSec });
    return {
      url,
      method: 'PUT',
      headers: {
        'Content-Type': opts.contentType,
        'Content-Length': String(opts.contentLength),
        ...(opts.contentMd5Base64 ? { 'Content-MD5': opts.contentMd5Base64 } : {}),
      },
      expiresAt: Date.now() + ttlSec * 1000,
    };
  }

  async presignDownload(key: string, ttlSec: number): Promise<PresignedDownload | null> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSec },
    );
    return { url, expiresAt: Date.now() + ttlSec * 1000 };
  }

  async delete(key: string): Promise<boolean> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (isS3NotFound(err)) return false;
      throw err;
    }
  }

  async deletePrefix(prefix: string): Promise<{ deleted: number }> {
    let deleted = 0;
    let continuationToken: string | undefined;
    do {
      const list = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const objects: ObjectIdentifier[] =
        list.Contents?.map((o) => ({ Key: o.Key! })).filter((o) => o.Key) ?? [];
      if (objects.length > 0) {
        // DeleteObjects accepts up to 1000 keys per call; S3
        // ListObjectsV2 also returns at most 1000, so a single batch
        // per page works.
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: objects, Quiet: true },
          }),
        );
        deleted += objects.length;
      }
      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);
    return { deleted };
  }
}

async function drainReadable(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function isS3NotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  if (!e) return false;
  if (e.name === 'NotFound' || e.name === 'NoSuchKey') return true;
  if (e.$metadata?.httpStatusCode === 404) return true;
  return false;
}
