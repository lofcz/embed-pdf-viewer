import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  KmsAadMismatch,
  KmsUnreachable,
  canonicalAad,
  type DataKey,
  type KmsKeyring,
  type WrappedDataKey,
} from '../KmsKeyring';

export interface AzureKeyVaultKeyringOptions {
  vaultUrl: string;
  keyName: string;
  keyVersion?: string;
}

type AzureCredential = unknown;

type AzureIdentityModule = {
  DefaultAzureCredential: new () => AzureCredential;
};

type AzureCryptographyClient = {
  wrapKey(algorithm: 'A256KW', key: Buffer): Promise<{ result?: Uint8Array }>;
  unwrapKey(algorithm: 'A256KW', encryptedKey: Buffer): Promise<{ result?: Uint8Array }>;
};

type AzureKeysModule = {
  CryptographyClient: new (keyId: string, credential: AzureCredential) => AzureCryptographyClient;
};

interface AzureWrappedDataKeyEnvelope {
  v: 1;
  mac: string;
  wrapped: string;
}

export class AzureKeyVaultKeyring implements KmsKeyring {
  readonly providerId = 'azure-kv' as const;
  readonly keyId: string;
  private readonly clientPromise: Promise<AzureCryptographyClient>;

  constructor(opts: AzureKeyVaultKeyringOptions) {
    this.keyId = keyUrl(opts);
    this.clientPromise = this.createClient();
  }

  async generateDataKey(aad?: Record<string, string>): Promise<DataKey> {
    const plaintext = randomBytes(32);
    try {
      const client = await this.clientPromise;
      const res = await client.wrapKey('A256KW', plaintext);
      if (!res.result)
        throw new KmsUnreachable(new Error('Azure Key Vault wrapKey returned no result'));
      return {
        plaintext,
        wrapped: {
          providerId: this.providerId,
          keyId: this.keyId,
          algorithm: 'AES_256_GCM',
          version: 1,
          ciphertext: encodeEnvelope({
            v: 1,
            mac: aadMac(plaintext, aad).toString('base64url'),
            wrapped: Buffer.from(res.result).toString('base64url'),
          }),
        },
      };
    } catch (err) {
      plaintext.fill(0);
      if (err instanceof KmsUnreachable) throw err;
      throw new KmsUnreachable(err);
    }
  }

  async decryptDataKey(wrapped: WrappedDataKey, aad?: Record<string, string>): Promise<Buffer> {
    if (
      wrapped.providerId !== this.providerId ||
      wrapped.keyId !== this.keyId ||
      wrapped.algorithm !== 'AES_256_GCM' ||
      wrapped.version !== 1
    ) {
      throw new KmsAadMismatch();
    }
    try {
      const envelope = decodeEnvelope(wrapped.ciphertext);
      const client = await this.clientPromise;
      const res = await client.unwrapKey('A256KW', Buffer.from(envelope.wrapped, 'base64url'));
      if (!res.result) throw new KmsAadMismatch();
      const plaintext = Buffer.from(res.result);
      if (plaintext.byteLength !== 32) throw new KmsAadMismatch();
      const actualMac = aadMac(plaintext, aad);
      const expectedMac = Buffer.from(envelope.mac, 'base64url');
      if (
        actualMac.byteLength !== expectedMac.byteLength ||
        !timingSafeEqual(actualMac, expectedMac)
      ) {
        throw new KmsAadMismatch();
      }
      return plaintext;
    } catch (err) {
      if (err instanceof KmsAadMismatch) throw err;
      if (isAzureKmsAuthFailure(err)) throw new KmsAadMismatch();
      throw new KmsUnreachable(err);
    }
  }

  private async createClient(): Promise<AzureCryptographyClient> {
    const [identity, keys] = await Promise.all([
      import('@azure/identity') as Promise<unknown> as Promise<AzureIdentityModule>,
      import('@azure/keyvault-keys') as Promise<unknown> as Promise<AzureKeysModule>,
    ]);
    return new keys.CryptographyClient(this.keyId, new identity.DefaultAzureCredential());
  }
}

function keyUrl(opts: AzureKeyVaultKeyringOptions): string {
  const root = opts.vaultUrl.replace(/\/+$/, '');
  const key = `${root}/keys/${opts.keyName}`;
  return opts.keyVersion ? `${key}/${opts.keyVersion}` : key;
}

function aadMac(dataKey: Buffer, aad: Record<string, string> | undefined): Buffer {
  return createHmac('sha256', dataKey).update(canonicalAad(aad)).digest();
}

function encodeEnvelope(envelope: AzureWrappedDataKeyEnvelope): Buffer {
  return Buffer.from(JSON.stringify(envelope), 'utf8');
}

function decodeEnvelope(bytes: Buffer): AzureWrappedDataKeyEnvelope {
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as Partial<AzureWrappedDataKeyEnvelope>;
    if (parsed.v !== 1 || typeof parsed.mac !== 'string' || typeof parsed.wrapped !== 'string') {
      throw new KmsAadMismatch();
    }
    return parsed as AzureWrappedDataKeyEnvelope;
  } catch (err) {
    if (err instanceof KmsAadMismatch) throw err;
    throw new KmsAadMismatch();
  }
}

function isAzureKmsAuthFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const statusCode = (err as { statusCode?: unknown }).statusCode;
  const code = (err as { code?: unknown }).code;
  return statusCode === 404 || code === 'KeyNotFound' || code === 'CryptographyError';
}
