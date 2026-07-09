import { describe, expect, it } from 'vitest';

import { buildToolRegistry } from './tools';

describe('annotation tool registry', () => {
  it('declares Replace Text as a strikeout-backed text-edit recipe', () => {
    const tool = buildToolRegistry().get('replace-text');
    expect(tool).toMatchObject({
      id: 'replace-text',
      subtype: 'strikeout',
      preset: 'replace-text',
      propsKind: 'strikeout',
      selection: { kind: 'text-edit', operation: 'replace' },
      defaults: { color: '#ef4444' },
    });
  });

  it('inherits the selection recipe when an embedder extends Replace Text', () => {
    const tool = buildToolRegistry([{ id: 'legal-replace', extends: 'replace-text' }]).get(
      'legal-replace',
    );
    expect(tool?.selection).toEqual({ kind: 'text-edit', operation: 'replace' });
    expect(tool?.subtype).toBe('strikeout');
  });
});
