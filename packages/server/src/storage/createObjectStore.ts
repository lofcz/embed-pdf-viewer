/**
 * Factory for ObjectStore instances. Matches the unified adapter
 * pattern (see ADAPTERS.md) — switch on `config.kind`, accept a
 * SecretResolver via `opts.resolver` for SecretRef-bearing variants
 * (none of today's storage variants need it; the param is reserved
 * for future credential-via-SecretRef configurations).
 *
 * Returns synchronously today because no current adapter needs
 * async construction. Signature is `async` so future adapters (e.g.,
 * any kind that needs to resolve a SecretRef at construction) fit
 * without a breaking change.
 */

import type { SecretResolver } from '../security/secrets/SecretResolver';
import type { ObjectStoreConfig } from './config/ObjectStoreConfigSchema';
import type { ObjectStore } from './ObjectStore';
import { FsObjectStore } from './adapters/FsObjectStore';
import { S3ObjectStore } from './adapters/S3ObjectStore';

export interface CreateObjectStoreOptions {
  /**
   * Reserved for future variants that need to resolve SecretRef
   * fields at construction (e.g., AWS access keys not provided via
   * the default credential chain). Unused by `fs` and `s3` today.
   */
  resolver?: SecretResolver;
}

export async function createObjectStore(
  config: ObjectStoreConfig,
  _opts: CreateObjectStoreOptions = {},
): Promise<ObjectStore> {
  switch (config.kind) {
    case 'fs':
      return new FsObjectStore({ root: config.root });
    case 's3':
      return new S3ObjectStore({
        bucket: config.bucket,
        region: config.region,
        endpoint: config.endpoint,
      });
    case 'gcs':
      throw new Error(
        'GcsObjectStore is not yet implemented; install a follow-up release or use kind=s3 with an S3-compatible endpoint',
      );
    case 'azure-blob':
      throw new Error(
        'AzureBlobObjectStore is not yet implemented; install a follow-up release or use kind=s3 with an S3-compatible endpoint',
      );
  }
}
