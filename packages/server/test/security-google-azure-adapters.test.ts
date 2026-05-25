import { Buffer } from 'node:buffer';
import { describe, expect, test, beforeEach, vi } from 'vitest';
import {
  AzureKeyVaultKeyring,
  AzureKeyVaultSecretsProvider,
  GcpKmsKeyring,
  GcpSecretManagerProvider,
  KmsAadMismatch,
  SecretNotFound,
} from '../src/index';

const cloud = vi.hoisted(() => ({
  gcpSecretAccess: vi.fn(),
  gcpKmsEncrypt: vi.fn(),
  gcpKmsDecrypt: vi.fn(),
  azureSecretGet: vi.fn(),
  azureWrapKey: vi.fn(),
  azureUnwrapKey: vi.fn(),
  azureCredentials: 0,
  azureSecretClientOptions: [] as unknown[],
  azureCryptoClientOptions: [] as unknown[],
}));

vi.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: class {
    accessSecretVersion(input: unknown) {
      return cloud.gcpSecretAccess(input);
    }
  },
}));

vi.mock('@google-cloud/kms', () => ({
  KeyManagementServiceClient: class {
    encrypt(input: unknown) {
      return cloud.gcpKmsEncrypt(input);
    }

    decrypt(input: unknown) {
      return cloud.gcpKmsDecrypt(input);
    }
  },
}));

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class {
    constructor() {
      cloud.azureCredentials++;
    }
  },
}));

vi.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class {
    constructor(vaultUrl: string, credential: unknown) {
      cloud.azureSecretClientOptions.push({ vaultUrl, credential });
    }

    getSecret(name: string, opts?: unknown) {
      return cloud.azureSecretGet(name, opts);
    }
  },
}));

vi.mock('@azure/keyvault-keys', () => ({
  CryptographyClient: class {
    constructor(keyId: string, credential: unknown) {
      cloud.azureCryptoClientOptions.push({ keyId, credential });
    }

    wrapKey(algorithm: string, key: Buffer) {
      return cloud.azureWrapKey(algorithm, key);
    }

    unwrapKey(algorithm: string, encryptedKey: Buffer) {
      return cloud.azureUnwrapKey(algorithm, encryptedKey);
    }
  },
}));

describe('GcpSecretManagerProvider', () => {
  beforeEach(() => resetCloudMocks());

  test('reads a JSON-keyed secret from Google Secret Manager', async () => {
    cloud.gcpSecretAccess.mockResolvedValue([
      {
        name: 'projects/acme/secrets/prod-embedpdf/versions/7',
        payload: { data: Buffer.from(JSON.stringify({ jwtSecret: 'gcp-secret' })) },
      },
    ]);

    const provider = new GcpSecretManagerProvider({ project: 'acme' });
    const value = await provider.get({
      provider: 'gcp',
      name: 'prod-embedpdf',
      version: '7',
      jsonKey: 'jwtSecret',
    });

    expect(value.bytes.toString('utf8')).toBe('gcp-secret');
    expect(value.version).toBe('7');
    expect(cloud.gcpSecretAccess).toHaveBeenCalledWith({
      name: 'projects/acme/secrets/prod-embedpdf/versions/7',
    });
  });

  test('maps Google not-found responses to SecretNotFound', async () => {
    cloud.gcpSecretAccess.mockRejectedValue(Object.assign(new Error('missing'), { code: 5 }));

    const provider = new GcpSecretManagerProvider({ project: 'acme' });
    await expect(provider.get({ provider: 'gcp', name: 'missing' })).rejects.toBeInstanceOf(
      SecretNotFound,
    );
  });
});

describe('GcpKmsKeyring', () => {
  beforeEach(() => resetCloudMocks());

  test('wraps local data keys with Google KMS and native AAD', async () => {
    const ciphertext = Buffer.from('gcp-wrapped-data-key');
    cloud.gcpKmsEncrypt.mockResolvedValue([{ ciphertext }]);

    const keyring = new GcpKmsKeyring({
      keyId: 'projects/acme/locations/global/keyRings/embedpdf/cryptoKeys/main',
    });
    const dataKey = await keyring.generateDataKey({ tenantId: 'tenant-a' });

    expect(dataKey.plaintext.byteLength).toBe(32);
    expect(dataKey.wrapped).toMatchObject({
      providerId: 'gcp-kms',
      keyId: 'projects/acme/locations/global/keyRings/embedpdf/cryptoKeys/main',
      algorithm: 'AES_256_GCM',
      version: 1,
    });
    expect(dataKey.wrapped.ciphertext.equals(ciphertext)).toBe(true);
    expect(cloud.gcpKmsEncrypt.mock.calls[0]?.[0]).toMatchObject({
      name: 'projects/acme/locations/global/keyRings/embedpdf/cryptoKeys/main',
      additionalAuthenticatedData: Buffer.from('[["tenantId","tenant-a"]]'),
    });
    expect(
      (cloud.gcpKmsEncrypt.mock.calls[0]?.[0] as { plaintext: Buffer }).plaintext.byteLength,
    ).toBe(32);
  });

  test('decrypts with the same Google KMS AAD and maps auth failures', async () => {
    const plaintext = Buffer.alloc(32, 4);
    const ciphertext = Buffer.from('gcp-wrapped-data-key');
    cloud.gcpKmsDecrypt.mockResolvedValueOnce([{ plaintext }]);

    const keyring = new GcpKmsKeyring({
      keyId: 'projects/acme/locations/global/keyRings/r/cryptoKeys/k',
    });
    await expect(
      keyring.decryptDataKey(
        {
          providerId: 'gcp-kms',
          keyId: 'projects/acme/locations/global/keyRings/r/cryptoKeys/k',
          algorithm: 'AES_256_GCM',
          version: 1,
          ciphertext,
        },
        { tenantId: 'tenant-a' },
      ),
    ).resolves.toEqual(plaintext);
    expect(cloud.gcpKmsDecrypt.mock.calls[0]?.[0]).toMatchObject({
      name: 'projects/acme/locations/global/keyRings/r/cryptoKeys/k',
      ciphertext,
      additionalAuthenticatedData: Buffer.from('[["tenantId","tenant-a"]]'),
    });

    cloud.gcpKmsDecrypt.mockRejectedValueOnce(Object.assign(new Error('bad aad'), { code: 3 }));
    await expect(
      keyring.decryptDataKey(
        {
          providerId: 'gcp-kms',
          keyId: 'projects/acme/locations/global/keyRings/r/cryptoKeys/k',
          algorithm: 'AES_256_GCM',
          version: 1,
          ciphertext,
        },
        { tenantId: 'tenant-b' },
      ),
    ).rejects.toBeInstanceOf(KmsAadMismatch);
  });
});

describe('AzureKeyVaultSecretsProvider', () => {
  beforeEach(() => resetCloudMocks());

  test('reads a JSON-keyed secret from Azure Key Vault', async () => {
    cloud.azureSecretGet.mockResolvedValue({
      value: JSON.stringify({ jwtSecret: 'azure-secret' }),
      properties: { version: 'v1' },
    });

    const provider = new AzureKeyVaultSecretsProvider({
      vaultUrl: 'https://vault.vault.azure.net',
    });
    const value = await provider.get({
      provider: 'azure',
      name: 'embedpdf',
      version: 'v1',
      jsonKey: 'jwtSecret',
    });

    expect(value.bytes.toString('utf8')).toBe('azure-secret');
    expect(value.version).toBe('v1');
    expect(cloud.azureSecretGet).toHaveBeenCalledWith('embedpdf', { version: 'v1' });
  });

  test('maps Azure not-found responses to SecretNotFound', async () => {
    cloud.azureSecretGet.mockRejectedValue(
      Object.assign(new Error('missing'), { statusCode: 404 }),
    );

    const provider = new AzureKeyVaultSecretsProvider({
      vaultUrl: 'https://vault.vault.azure.net',
    });
    await expect(provider.get({ provider: 'azure', name: 'missing' })).rejects.toBeInstanceOf(
      SecretNotFound,
    );
  });
});

describe('AzureKeyVaultKeyring', () => {
  beforeEach(() => resetCloudMocks());

  test('wraps data keys and enforces AAD with an HMAC inside the envelope', async () => {
    cloud.azureWrapKey.mockResolvedValue({ result: Buffer.from('azure-wrapped-data-key') });

    const keyring = new AzureKeyVaultKeyring({
      vaultUrl: 'https://vault.vault.azure.net',
      keyName: 'embedpdf',
      keyVersion: '123',
    });
    const dataKey = await keyring.generateDataKey({ tenantId: 'tenant-a' });

    expect(dataKey.plaintext.byteLength).toBe(32);
    expect(dataKey.wrapped).toMatchObject({
      providerId: 'azure-kv',
      keyId: 'https://vault.vault.azure.net/keys/embedpdf/123',
      algorithm: 'AES_256_GCM',
      version: 1,
    });
    expect(cloud.azureCryptoClientOptions[0]).toMatchObject({
      keyId: 'https://vault.vault.azure.net/keys/embedpdf/123',
    });
    expect(cloud.azureWrapKey.mock.calls[0]?.[0]).toBe('A256KW');
    expect((cloud.azureWrapKey.mock.calls[0]?.[1] as Buffer).byteLength).toBe(32);

    cloud.azureUnwrapKey.mockResolvedValue({ result: dataKey.plaintext });
    await expect(
      keyring.decryptDataKey(dataKey.wrapped, { tenantId: 'tenant-a' }),
    ).resolves.toEqual(dataKey.plaintext);
    await expect(
      keyring.decryptDataKey(dataKey.wrapped, { tenantId: 'tenant-b' }),
    ).rejects.toBeInstanceOf(KmsAadMismatch);
  });
});

function resetCloudMocks(): void {
  cloud.gcpSecretAccess.mockReset();
  cloud.gcpKmsEncrypt.mockReset();
  cloud.gcpKmsDecrypt.mockReset();
  cloud.azureSecretGet.mockReset();
  cloud.azureWrapKey.mockReset();
  cloud.azureUnwrapKey.mockReset();
  cloud.azureCredentials = 0;
  cloud.azureSecretClientOptions.length = 0;
  cloud.azureCryptoClientOptions.length = 0;
}
