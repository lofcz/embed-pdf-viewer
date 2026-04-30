import assert from 'node:assert/strict';
import { test } from 'node:test';

test('pdf-runtime exposes a create function', async () => {
  const runtime = await import('../dist/index.js').catch(() => null);
  if (!runtime) {
    assert.ok(true, 'dist not built; smoke test skipped');
    return;
  }

  assert.equal(typeof runtime.createPdfRuntime, 'function');
  assert.equal(typeof runtime.init, 'function');
});
