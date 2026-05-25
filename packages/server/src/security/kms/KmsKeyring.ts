export type KmsProviderId = 'static' | 'aws-kms' | 'gcp-kms' | 'azure-kv';

export interface WrappedDataKey {
  readonly providerId: KmsProviderId;
  readonly keyId: string;
  readonly algorithm: 'AES_256_GCM';
  readonly ciphertext: Buffer;
  readonly version: 1;
}

export interface DataKey {
  readonly plaintext: Buffer;
  readonly wrapped: WrappedDataKey;
}

export interface KmsKeyring {
  readonly keyId: string;
  readonly providerId: KmsProviderId;
  generateDataKey(aad?: Record<string, string>): Promise<DataKey>;
  decryptDataKey(wrapped: WrappedDataKey, aad?: Record<string, string>): Promise<Buffer>;
}

export class KmsAadMismatch extends Error {
  constructor() {
    super('KMS AAD mismatch or wrapped data key authentication failed');
    this.name = 'KmsAadMismatch';
  }
}

export class KmsUnreachable extends Error {
  constructor(cause: unknown) {
    super('KMS provider unreachable');
    this.name = 'KmsUnreachable';
    this.cause = cause;
  }
}

export function canonicalAad(aad: Record<string, string> | undefined): Buffer {
  if (!aad) return Buffer.alloc(0);
  const sorted = Object.keys(aad)
    .sort()
    .map((key) => [key, aad[key]] as const);
  return Buffer.from(JSON.stringify(sorted), 'utf8');
}
