import type { KmsConfig } from '../config/SecurityConfigSchema';
import type { KmsKeyring } from './KmsKeyring';
import { StaticKmsKeyring } from './adapters/StaticKmsKeyring';
import { AwsKmsKeyring } from './adapters/AwsKmsKeyring';
import { GcpKmsKeyring } from './adapters/GcpKmsKeyring';
import { AzureKeyVaultKeyring } from './adapters/AzureKeyVaultKeyring';

export interface CreateKmsKeyringOptions {
  staticKmsKek?: Buffer;
}

export function createKmsKeyring(
  config: KmsConfig,
  opts: CreateKmsKeyringOptions = {},
): KmsKeyring {
  switch (config.kind) {
    case 'static':
      if (!opts.staticKmsKek) {
        throw new Error('static KMS requires opts.staticKmsKek');
      }
      return new StaticKmsKeyring({ keyId: config.keyId, kek: opts.staticKmsKek });
    case 'aws-kms':
      return new AwsKmsKeyring({
        keyId: config.keyId,
        region: config.region,
        endpoint: config.endpoint,
      });
    case 'gcp-kms':
      return new GcpKmsKeyring({ keyId: config.keyId });
    case 'azure-kv':
      return new AzureKeyVaultKeyring({
        vaultUrl: config.vaultUrl,
        keyName: config.keyName,
        keyVersion: config.keyVersion,
      });
  }
}
