import { CachingSecretsProvider } from '../secrets/CachingSecretsProvider';
import {
  createSecretsProviderRegistry,
  type SecretsProviderRegistry,
} from '../secrets/createSecretsProvider';
import { createSecretResolver, type SecretResolver } from '../secrets/SecretResolver';
import { createKmsKeyring } from '../kms/createKmsKeyring';
import type { KmsKeyring } from '../kms/KmsKeyring';
import { validateSecurityConfigProviderRefs, type SecurityConfig } from './SecurityConfigSchema';

export interface SecurityRuntime {
  readonly providers: SecretsProviderRegistry;
  readonly resolve: SecretResolver['resolve'];
  readonly kms: KmsKeyring;
}

export interface CreateSecurityRuntimeOptions {
  env?: NodeJS.ProcessEnv;
}

export async function createSecurityRuntime(
  config: SecurityConfig,
  opts: CreateSecurityRuntimeOptions = {},
): Promise<SecurityRuntime> {
  validateSecurityConfigProviderRefs(config);
  const rawProviders = createSecretsProviderRegistry(config.secrets.providers, { env: opts.env });
  const providers = new Map(
    Array.from(rawProviders.entries()).map(([id, provider]) => [
      id,
      new CachingSecretsProvider(provider, { ttlMs: config.secrets.cache.ttlSec * 1000 }),
    ]),
  );
  const resolver = createSecretResolver(providers);
  const staticKms =
    config.kms.kind === 'static'
      ? await resolver.resolve({
          kek: { ref: config.kms.kek, as: 'buffer' },
        })
      : null;
  const kms = createKmsKeyring(config.kms, {
    ...(staticKms ? { staticKmsKek: staticKms.kek } : {}),
  });
  return { providers, resolve: resolver.resolve, kms };
}
