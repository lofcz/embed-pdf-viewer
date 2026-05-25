import type { SecretsProvider } from './SecretsProvider';
import { EnvSecretsProvider } from './adapters/EnvSecretsProvider';
import { FileSecretsProvider } from './adapters/FileSecretsProvider';
import { AwsSecretsManagerProvider } from './adapters/AwsSecretsManagerProvider';
import { GcpSecretManagerProvider } from './adapters/GcpSecretManagerProvider';
import { AzureKeyVaultSecretsProvider } from './adapters/AzureKeyVaultSecretsProvider';
import type { SecretProviderConfig } from '../config/SecurityConfigSchema';

export type SecretsProviderRegistry = ReadonlyMap<string, SecretsProvider>;

export interface CreateSecretsProviderOptions {
  env?: NodeJS.ProcessEnv;
}

export function createSecretsProvider(
  config: SecretProviderConfig,
  opts: CreateSecretsProviderOptions = {},
): SecretsProvider {
  switch (config.kind) {
    case 'env':
      return new EnvSecretsProvider(opts.env);
    case 'file':
      return new FileSecretsProvider({ root: config.root });
    case 'aws-sm':
      return new AwsSecretsManagerProvider({
        region: config.region,
        endpoint: config.endpoint,
      });
    case 'gcp-sm':
      return new GcpSecretManagerProvider({ project: config.project });
    case 'azure-kv':
      return new AzureKeyVaultSecretsProvider({ vaultUrl: config.vaultUrl });
  }
}

export function createSecretsProviderRegistry(
  configs: Record<string, SecretProviderConfig>,
  opts: CreateSecretsProviderOptions = {},
): SecretsProviderRegistry {
  return new Map(
    Object.entries(configs).map(
      ([id, config]) => [id, createSecretsProvider(config, opts)] as const,
    ),
  );
}
