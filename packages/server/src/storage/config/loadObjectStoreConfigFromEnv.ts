/**
 * Build an ObjectStoreConfig from environment variables.
 *
 * Convention:
 *   EMBEDPDF_STORAGE_KIND=fs|s3|gcs|azure-blob   (default: fs)
 *
 *   # fs
 *   EMBEDPDF_STORAGE_FS_ROOT=./data/objects      (default; also accepts EMBEDPDF_STORAGE_ROOT for back-compat)
 *
 *   # s3
 *   EMBEDPDF_STORAGE_S3_BUCKET=embedpdf-prod
 *   EMBEDPDF_STORAGE_S3_REGION=us-east-1
 *   EMBEDPDF_STORAGE_S3_ENDPOINT=https://...      (optional, for S3-compatible)
 *
 *   # gcs (adapter ships in follow-up commit)
 *   EMBEDPDF_STORAGE_GCS_BUCKET=embedpdf-prod
 *   EMBEDPDF_STORAGE_GCS_PROJECT_ID=...           (optional)
 *
 *   # azure-blob (adapter ships in follow-up commit)
 *   EMBEDPDF_STORAGE_AZURE_BLOB_CONTAINER=embedpdf
 *   EMBEDPDF_STORAGE_AZURE_BLOB_ACCOUNT_NAME=embedpdfprod
 *   EMBEDPDF_STORAGE_AZURE_BLOB_ENDPOINT=https://... (optional)
 */

import { ObjectStoreConfigSchema, type ObjectStoreConfig } from './ObjectStoreConfigSchema';

export function loadObjectStoreConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStoreConfig {
  const kind = (env['EMBEDPDF_STORAGE_KIND'] ?? 'fs').toLowerCase();
  switch (kind) {
    case 'fs': {
      const root =
        env['EMBEDPDF_STORAGE_FS_ROOT'] ?? env['EMBEDPDF_STORAGE_ROOT'] ?? './data/objects';
      return ObjectStoreConfigSchema.parse({ kind: 'fs', root });
    }
    case 's3': {
      const bucket = req(env, 'EMBEDPDF_STORAGE_S3_BUCKET');
      const region = req(env, 'EMBEDPDF_STORAGE_S3_REGION');
      const endpoint = env['EMBEDPDF_STORAGE_S3_ENDPOINT'];
      return ObjectStoreConfigSchema.parse({
        kind: 's3',
        bucket,
        region,
        ...(endpoint ? { endpoint } : {}),
      });
    }
    case 'gcs': {
      const bucket = req(env, 'EMBEDPDF_STORAGE_GCS_BUCKET');
      const projectId = env['EMBEDPDF_STORAGE_GCS_PROJECT_ID'];
      return ObjectStoreConfigSchema.parse({
        kind: 'gcs',
        bucket,
        ...(projectId ? { projectId } : {}),
      });
    }
    case 'azure-blob': {
      const container = req(env, 'EMBEDPDF_STORAGE_AZURE_BLOB_CONTAINER');
      const accountName = req(env, 'EMBEDPDF_STORAGE_AZURE_BLOB_ACCOUNT_NAME');
      const endpoint = env['EMBEDPDF_STORAGE_AZURE_BLOB_ENDPOINT'];
      return ObjectStoreConfigSchema.parse({
        kind: 'azure-blob',
        container,
        accountName,
        ...(endpoint ? { endpoint } : {}),
      });
    }
    default:
      throw new Error(
        `EMBEDPDF_STORAGE_KIND="${kind}" is not recognized (expected fs|s3|gcs|azure-blob)`,
      );
  }
}

function req(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}
