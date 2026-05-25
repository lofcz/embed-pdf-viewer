import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { describe, expect, test } from 'vitest';
import { createSecurityRuntime, defaultEnvSecurityConfig, LocalAesGcmEnvelope } from '../src/index';

describe('createSecurityRuntime', () => {
  test('builds providers and KMS, while callers explicitly resolve their own secrets', async () => {
    const env = {
      EMBEDPDF_STATIC_KMS_KEK: Buffer.alloc(32, 9).toString('base64'),
      APP_JWT_SECRET: 'demo-jwt-secret',
      APP_JSON_SECRET: JSON.stringify({ answer: 42 }),
    };
    const security = await createSecurityRuntime(defaultEnvSecurityConfig(env), { env });

    const secrets = await security.resolve({
      jwtSecretBuffer: { provider: 'env', name: 'APP_JWT_SECRET' },
      jwtSecretString: {
        ref: { provider: 'env', name: 'APP_JWT_SECRET' },
        as: 'string',
      },
      appConfig: {
        ref: { provider: 'env', name: 'APP_JSON_SECRET' },
        as: 'json',
        schema: z.object({ answer: z.number() }),
      },
    });

    expect(Buffer.isBuffer(secrets.jwtSecretBuffer)).toBe(true);
    expect(secrets.jwtSecretBuffer.toString('utf8')).toBe('demo-jwt-secret');
    expect(secrets.jwtSecretString).toBe('demo-jwt-secret');
    expect(secrets.appConfig).toEqual({ answer: 42 });

    const blob = await LocalAesGcmEnvelope.encrypt(Buffer.from('payload'), security.kms, {
      tenantId: 'tenant-a',
    });
    const roundTrip = await LocalAesGcmEnvelope.decrypt(blob, security.kms, {
      tenantId: 'tenant-a',
    });
    expect(roundTrip.toString('utf8')).toBe('payload');
  });
});
