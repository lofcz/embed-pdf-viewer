import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runFormConformance, type ConformanceTestRunner } from '@embedpdf/engine-core/conformance';
import { createCloudEngine } from '../src/index';
import {
  buildDbSeededFixture,
  seedDocumentFromBytes,
  teardownDbSeededFixture,
  tenantToken,
  type DbSeededFixture,
} from './_helpers/db-seeded-app';

const here = dirname(fileURLToPath(import.meta.url));
const resources = resolve(
  here,
  '..',
  '..',
  '..',
  'packages',
  'pdf-runtime',
  'runtime-src',
  'testing',
  'resources',
);

const runner: ConformanceTestRunner = {
  describe,
  test,
  beforeAll,
  afterAll,
  expect: expect as unknown as ConformanceTestRunner['expect'],
};

let fx: DbSeededFixture | undefined;
const TENANT_ID = 'cloud-forms-conformance-tenant';

// The suite opens several independent documents, so the engine carries a
// TENANT token (doc-scoped tokens bind to one docId). The import target is
// a second copy of toggle_fields.pdf — id-opened docs are server state, so
// the round-trip test can't mint one by re-opening bytes.
const DOCS = {
  toggleFields: { id: 'toggle-fields-cloud', file: 'toggle_fields.pdf', pages: 1 },
  orphanWidgets: { id: 'orphan-widgets-cloud', file: 'orphan_widgets.pdf', pages: 1 },
  choiceFields: { id: 'listbox-form-cloud', file: 'listbox_form.pdf', pages: 1 },
  importTarget: { id: 'toggle-fields-import-target-cloud', file: 'toggle_fields.pdf', pages: 1 },
} as const;

beforeAll(async () => {
  fx = await buildDbSeededFixture({ secret: 'cloud-forms-conformance-secret' });
  for (const doc of Object.values(DOCS)) {
    await seedDocumentFromBytes(fx, TENANT_ID, doc.id, resolve(resources, doc.file), doc.pages);
  }
});

afterAll(async () => {
  await teardownDbSeededFixture(fx);
});

const fixture = (id: string) => ({
  id,
  bytes: async () => new Uint8Array(),
  expected: {},
});

runFormConformance(runner, {
  label: 'cloud engine (HTTP -> @cloudpdf/server, native runtime)',
  openKind: 'id',
  fixtures: {
    toggleFields: { ...fixture(DOCS.toggleFields.id), pageObjectNumber: 3 },
    orphanWidgets: fixture(DOCS.orphanWidgets.id),
    choiceFields: fixture(DOCS.choiceFields.id),
    importTarget: fixture(DOCS.importTarget.id),
  },
  makeEngine: () => {
    if (!fx) throw new Error('fixture not initialised');
    return createCloudEngine({
      baseUrl: fx.baseUrl,
      token: tenantToken(fx, TENANT_ID),
    });
  },
});
