import {
  decodeSecretBytes,
  SecretNotFound,
  SecretProviderUnreachable,
  type SecretRef,
  type SecretsProvider,
  type SecretValue,
} from '../SecretsProvider';

export class EnvSecretsProvider implements SecretsProvider {
  readonly kind = 'env';

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async get(ref: SecretRef): Promise<SecretValue> {
    try {
      const raw = this.env[ref.name];
      if (raw === undefined || raw === '') {
        throw new SecretNotFound(ref, this.kind);
      }
      return {
        bytes: decodeSecretBytes(Buffer.from(raw, 'utf8'), ref),
        fetchedAt: new Date(),
      };
    } catch (err) {
      if (err instanceof SecretNotFound) throw err;
      throw new SecretProviderUnreachable(this.kind, err);
    }
  }

  invalidate(_ref: SecretRef): void {
    // Env values are read from process.env on every uncached get.
  }
}
