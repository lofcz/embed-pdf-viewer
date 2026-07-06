import { describe, expect, test } from 'vitest';
import { canonicalSearchQuery, searchContentEpoch } from '../../src/shared';
import type { DocumentManifest } from '../../src/shared';

function manifest(
  layoutVersion: number,
  pages: Array<[pon: number, contentVersion: number]>,
): DocumentManifest {
  return {
    docVersion: 7,
    layoutVersion,
    metadataVersion: 3,
    auditHead: 42,
    baseSha: 'abc',
    pages: pages.map(([pon, contentVersion]) => ({
      state: { pageObjectNumber: pon } as DocumentManifest['pages'][number]['state'],
      cache: { contentVersion } as DocumentManifest['pages'][number]['cache'],
    })),
  };
}

describe('searchContentEpoch', () => {
  test('is deterministic and hex-shaped', () => {
    const a = searchContentEpoch(
      manifest(1, [
        [10, 1],
        [20, 1],
      ]),
    );
    const b = searchContentEpoch(
      manifest(1, [
        [10, 1],
        [20, 1],
      ]),
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  test('moves with page content, order, structure — the search inputs', () => {
    const base = searchContentEpoch(
      manifest(1, [
        [10, 1],
        [20, 1],
      ]),
    );
    // content edit (redaction) on one page
    expect(
      searchContentEpoch(
        manifest(1, [
          [10, 2],
          [20, 1],
        ]),
      ),
    ).not.toBe(base);
    // page order change
    expect(
      searchContentEpoch(
        manifest(1, [
          [20, 1],
          [10, 1],
        ]),
      ),
    ).not.toBe(base);
    // structural op (layoutVersion bump)
    expect(
      searchContentEpoch(
        manifest(2, [
          [10, 1],
          [20, 1],
        ]),
      ),
    ).not.toBe(base);
    // page delete
    expect(searchContentEpoch(manifest(1, [[10, 1]]))).not.toBe(base);
  });

  test('ignores docVersion/metadata churn (annotation edits must not invalidate)', () => {
    const a = manifest(1, [
      [10, 1],
      [20, 1],
    ]);
    const b = {
      ...manifest(1, [
        [10, 1],
        [20, 1],
      ]),
      docVersion: 99,
      metadataVersion: 12,
    };
    expect(searchContentEpoch(a)).toBe(searchContentEpoch(b));
  });
});

describe('canonicalSearchQuery', () => {
  test('folds default literal queries to one cache identity', () => {
    const a = canonicalSearchQuery({ kind: 'literal', text: 'Café' });
    const b = canonicalSearchQuery({ kind: 'literal', text: 'CAFE' });
    expect(a).toEqual(b);
    expect(a).toEqual({ kind: 'literal', text: 'cafe' });
  });

  test('is idempotent', () => {
    const once = canonicalSearchQuery({ kind: 'literal', text: 'Straße  und\tmehr' });
    expect(canonicalSearchQuery(once)).toEqual(once);
  });

  test('preserves wholeWord and leaves sensitive/regex queries untouched', () => {
    expect(canonicalSearchQuery({ kind: 'literal', text: 'Cat', wholeWord: true })).toEqual({
      kind: 'literal',
      text: 'cat',
      wholeWord: true,
    });
    const caseSensitive = { kind: 'literal', text: 'Cat', matchCase: true } as const;
    expect(canonicalSearchQuery(caseSensitive)).toEqual(caseSensitive);
    const regex = { kind: 'regex', pattern: 'C\\d+' } as const;
    expect(canonicalSearchQuery(regex)).toEqual(regex);
  });
});
