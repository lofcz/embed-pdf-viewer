import { describe, expect, test } from 'vitest';

import { mergeFontFallbacks, type RecipeFontSpec } from '../src/index';

describe('mergeFontFallbacks', () => {
  test('concatenates lists and skips nullish configs', () => {
    const latin: RecipeFontSpec[] = [{ key: 'latin', url: '/latin.ttf' }];
    const cjk: RecipeFontSpec[] = [{ key: 'cjk', url: '/cjk.otf' }];

    expect(mergeFontFallbacks(latin, null, undefined, cjk)).toEqual([
      { key: 'latin', url: '/latin.ttf' },
      { key: 'cjk', url: '/cjk.otf' },
    ]);
  });

  test('later configs win on overlapping keys, keeping first-seen order', () => {
    const first: RecipeFontSpec[] = [
      { key: 'latin', url: '/latin-v1.ttf', weight: 400 },
      { key: 'cjk', url: '/cjk.otf' },
    ];
    const second: RecipeFontSpec[] = [
      { key: 'latin', url: '/latin-v2.ttf', weight: 700 },
      { key: 'arabic', url: '/arabic.ttf' },
    ];

    expect(mergeFontFallbacks(first, second)).toEqual([
      { key: 'latin', url: '/latin-v2.ttf', weight: 700 },
      { key: 'cjk', url: '/cjk.otf' },
      { key: 'arabic', url: '/arabic.ttf' },
    ]);
  });

  test('an empty call yields an empty list', () => {
    expect(mergeFontFallbacks()).toEqual([]);
  });
});
