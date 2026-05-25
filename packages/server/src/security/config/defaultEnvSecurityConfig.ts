import {
  SecurityConfigSchema,
  validateSecurityConfigProviderRefs,
  type SecurityConfig,
} from './SecurityConfigSchema';

/**
 * Creates a small env-backed security runtime config for examples and
 * local development.
 *
 * This helper is intentionally not a full deployment config loader:
 * it declares where secrets can be resolved from and how KMS should be
 * constructed. Callers still explicitly choose which secrets to resolve.
 */
export function defaultEnvSecurityConfig(env: NodeJS.ProcessEnv = process.env): SecurityConfig {
  const staticKekName = env['EMBEDPDF_DEV_KEK'] ? 'EMBEDPDF_DEV_KEK' : 'EMBEDPDF_STATIC_KMS_KEK';
  const parsed = SecurityConfigSchema.parse({
    secrets: {
      providers: {
        env: { kind: 'env' },
      },
      cache: {
        ttlSec: Number(env['EMBEDPDF_SECRET_CACHE_TTL_SEC'] ?? 3600),
      },
    },
    kms: {
      kind: 'static',
      keyId: env['EMBEDPDF_STATIC_KMS_KEY_ID'] ?? 'static-dev',
      kek: { provider: 'env', name: staticKekName, encoding: 'base64' },
    },
  });
  validateSecurityConfigProviderRefs(parsed);
  return parsed;
}
