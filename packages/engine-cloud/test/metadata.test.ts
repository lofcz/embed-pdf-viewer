import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runMetadataConformance, type ConformanceTestRunner } from '@embedpdf/engine-core';
import { buildApp, signDevToken, defaultWorkerEntryUrl, type AppBundle } from '@embedpdf/server';
import { createCloudEngine } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(
  here,
  '..',
  '..',
  '..',
  'examples',
  'pdf-runtime-demo',
  'public',
  'sample.pdf',
);

const runner: ConformanceTestRunner = {
  describe,
  test,
  beforeAll,
  afterAll,
  expect: expect as unknown as ConformanceTestRunner['expect'],
};

let bundle: AppBundle | undefined;
let baseUrl = '';
const SECRET = 'cloud-conformance-secret';

beforeAll(async () => {
  bundle = await buildApp({
    jwtSecret: SECRET,
    poolSize: 1,
    workerEntry: defaultWorkerEntryUrl,
  });
  const addr = await bundle.app.listen({ host: '127.0.0.1', port: 0 });
  baseUrl = typeof addr === 'string' ? addr : `http://127.0.0.1:${addr}`;
});

afterAll(async () => {
  if (bundle) await bundle.shutdown();
});

runMetadataConformance(runner, {
  label: 'engine-cloud (HTTP -> @embedpdf/server, native runtime)',
  openKind: 'bytes',
  fixture: {
    id: 'sample-pdf-cloud',
    bytes: async () => new Uint8Array(await readFile(samplePath)),
    expected: {
      trapped: 'unknown',
    },
  },
  makeEngine: () =>
    createCloudEngine({
      baseUrl,
      token: signDevToken(SECRET, { sub: 'tester', tenant_id: 'conformance' }),
    }),
});
