/**
 * Family-local config schema for the Storage adapter family.
 *
 * Variants:
 *   - fs        : local filesystem (single-server / dev)
 *   - s3        : AWS S3 or S3-compatible endpoint (R2, MinIO, Wasabi, ...)
 *   - gcs       : Google Cloud Storage (adapter ships in a follow-up commit)
 *   - azure-blob: Azure Blob Storage      (adapter ships in a follow-up commit)
 *
 * `gcs` and `azure-blob` variants ARE valid in the schema today —
 * env-driven configs can reference them — but `createObjectStore`
 * throws a "not yet implemented" error when constructed. This lets
 * deployment templates be written ahead of the adapter implementations
 * landing.
 */

import { z } from 'zod';

export const ObjectStoreConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('fs'),
    root: z.string().min(1),
  }),
  z.object({
    kind: z.literal('s3'),
    bucket: z.string().min(1),
    region: z.string().min(1),
    endpoint: z.string().url().optional(),
  }),
  z.object({
    kind: z.literal('gcs'),
    bucket: z.string().min(1),
    projectId: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('azure-blob'),
    container: z.string().min(1),
    accountName: z.string().min(1),
    endpoint: z.string().url().optional(),
  }),
]);

export type ObjectStoreConfig = z.infer<typeof ObjectStoreConfigSchema>;
