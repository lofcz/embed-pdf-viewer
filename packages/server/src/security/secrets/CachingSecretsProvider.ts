import type { SecretRef, SecretsProvider, SecretValue } from './SecretsProvider';

export interface CachingSecretsProviderOptions {
  ttlMs: number;
}

export class CachingSecretsProvider implements SecretsProvider {
  readonly kind: string;
  private readonly cache = new Map<string, { value: SecretValue; expiresAt: number }>();

  constructor(
    private readonly inner: SecretsProvider,
    private readonly opts: CachingSecretsProviderOptions,
  ) {
    this.kind = `${inner.kind}+cache`;
  }

  async get(ref: SecretRef): Promise<SecretValue> {
    const key = cacheKey(ref);
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;
    const value = await this.inner.get(ref);
    this.cache.set(key, { value, expiresAt: now + this.opts.ttlMs });
    return value;
  }

  invalidate(ref: SecretRef): void {
    this.cache.delete(cacheKey(ref));
    this.inner.invalidate(ref);
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}

function cacheKey(ref: SecretRef): string {
  return JSON.stringify({
    provider: ref.provider,
    name: ref.name,
    jsonKey: ref.jsonKey ?? null,
    encoding: ref.encoding ?? null,
    version: ref.version ?? null,
    versionStage: ref.versionStage ?? null,
  });
}
