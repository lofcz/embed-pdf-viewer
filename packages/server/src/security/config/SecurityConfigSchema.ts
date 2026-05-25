import { z } from 'zod';

export const SecretEncodingSchema = z.enum(['raw', 'utf8', 'base64', 'hex']);

export const SecretRefSchema = z.object({
  provider: z.string().min(1),
  name: z.string().min(1),
  jsonKey: z.string().min(1).optional(),
  encoding: SecretEncodingSchema.optional(),
  version: z.string().min(1).optional(),
  versionStage: z.string().min(1).optional(),
});

export const SecretProviderConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('env') }),
  z.object({ kind: z.literal('file'), root: z.string().min(1) }),
  z.object({
    kind: z.literal('aws-sm'),
    region: z.string().min(1),
    endpoint: z.string().url().optional(),
  }),
  z.object({ kind: z.literal('gcp-sm'), project: z.string().min(1) }),
  z.object({ kind: z.literal('azure-kv'), vaultUrl: z.string().url() }),
]);

export const KmsConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('static'),
    keyId: z.string().min(1).default('static-dev'),
    kek: SecretRefSchema,
  }),
  z.object({
    kind: z.literal('aws-kms'),
    keyId: z.string().min(1),
    region: z.string().min(1),
    endpoint: z.string().url().optional(),
  }),
  z.object({
    kind: z.literal('gcp-kms'),
    keyId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('azure-kv'),
    vaultUrl: z.string().url(),
    keyName: z.string().min(1),
    keyVersion: z.string().min(1).optional(),
  }),
]);

export const SecurityConfigSchema = z.object({
  secrets: z.object({
    providers: z.record(SecretProviderConfigSchema),
    cache: z
      .object({
        ttlSec: z.number().int().positive().default(3600),
      })
      .default({ ttlSec: 3600 }),
  }),
  kms: KmsConfigSchema,
});

export type SecretRefConfig = z.infer<typeof SecretRefSchema>;
export type SecretProviderConfig = z.infer<typeof SecretProviderConfigSchema>;
export type KmsConfig = z.infer<typeof KmsConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

export function validateSecurityConfigProviderRefs(config: SecurityConfig): void {
  const providers = new Set(Object.keys(config.secrets.providers));
  const refs = config.kms.kind === 'static' ? ([['kms.kek', config.kms.kek]] as const) : [];
  for (const [label, ref] of refs) {
    if (ref && !providers.has(ref.provider)) {
      throw new Error(`${label} references unknown secrets provider "${ref.provider}"`);
    }
  }
}
