/**
 * Build a KmsConfig from environment variables.
 *
 * Convention:
 *   EMBEDPDF_KMS_KIND=static|aws-kms|gcp-kms|azure-kv  (default: static)
 *
 *   # static (requires a SecretRef for the KEK)
 *   EMBEDPDF_KMS_STATIC_KEY_ID=static-dev               (default 'static-dev')
 *   EMBEDPDF_KMS_STATIC_KEK=secret://<provider>/<name>?encoding=base64
 *
 *   # aws-kms
 *   EMBEDPDF_KMS_AWS_KMS_KEY_ID=arn:aws:kms:...
 *   EMBEDPDF_KMS_AWS_KMS_REGION=us-east-1
 *   EMBEDPDF_KMS_AWS_KMS_ENDPOINT=https://kms.local   (optional)
 *
 *   # gcp-kms
 *   EMBEDPDF_KMS_GCP_KMS_KEY_ID=projects/.../cryptoKeys/...
 *
 *   # azure-kv
 *   EMBEDPDF_KMS_AZURE_KV_VAULT_URL=https://my.vault.azure.net
 *   EMBEDPDF_KMS_AZURE_KV_KEY_NAME=my-key
 *   EMBEDPDF_KMS_AZURE_KV_KEY_VERSION=...              (optional)
 *   EMBEDPDF_KMS_AZURE_KV_MODE=managed-hsm-a256gcm|key-vault-rsa-oaep-256  (optional)
 *
 * For `EMBEDPDF_KMS_STATIC_KEK`, the value is parsed as a
 * `secret://<provider>/<name>?jsonKey=&encoding=` URI into a SecretRef.
 * Plain strings are NOT accepted for the KEK — it must point at a
 * secrets-provider entry.
 */

import { KmsConfigSchema, type KmsConfig } from './KmsConfigSchema';
import { parseSecretRefUri } from '../../../config/secrets/parseSecretRefUri';

export function loadKmsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): KmsConfig {
  const kind = env['EMBEDPDF_KMS_KIND'] ?? 'static';
  switch (kind) {
    case 'static': {
      const kekRaw = env['EMBEDPDF_KMS_STATIC_KEK'];
      if (!kekRaw) {
        throw new Error(
          'EMBEDPDF_KMS_STATIC_KEK is required for static KMS (secret://<provider>/<name>?encoding=base64)',
        );
      }
      const kek = parseSecretRefUri(kekRaw);
      return KmsConfigSchema.parse({
        kind: 'static',
        ...(env['EMBEDPDF_KMS_STATIC_KEY_ID'] ? { keyId: env['EMBEDPDF_KMS_STATIC_KEY_ID'] } : {}),
        kek,
      });
    }
    case 'aws-kms': {
      const keyId = req(env, 'EMBEDPDF_KMS_AWS_KMS_KEY_ID');
      const region = req(env, 'EMBEDPDF_KMS_AWS_KMS_REGION');
      const endpoint = env['EMBEDPDF_KMS_AWS_KMS_ENDPOINT'];
      return KmsConfigSchema.parse({
        kind: 'aws-kms',
        keyId,
        region,
        ...(endpoint ? { endpoint } : {}),
      });
    }
    case 'gcp-kms': {
      const keyId = req(env, 'EMBEDPDF_KMS_GCP_KMS_KEY_ID');
      return KmsConfigSchema.parse({ kind: 'gcp-kms', keyId });
    }
    case 'azure-kv': {
      const vaultUrl = req(env, 'EMBEDPDF_KMS_AZURE_KV_VAULT_URL');
      const keyName = req(env, 'EMBEDPDF_KMS_AZURE_KV_KEY_NAME');
      const keyVersion = env['EMBEDPDF_KMS_AZURE_KV_KEY_VERSION'];
      const mode = env['EMBEDPDF_KMS_AZURE_KV_MODE'];
      return KmsConfigSchema.parse({
        kind: 'azure-kv',
        vaultUrl,
        keyName,
        ...(keyVersion ? { keyVersion } : {}),
        ...(mode ? { mode } : {}),
      });
    }
    default:
      throw new Error(
        `EMBEDPDF_KMS_KIND="${kind}" is not recognized (expected static|aws-kms|gcp-kms|azure-kv)`,
      );
  }
}

function req(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}
