import { describe, expect, test } from 'vitest';
import { getActiveBookmarkPath, resolveBookmarkPageIndex } from './active-bookmark';
import { OutlineActionType, type OutlineBookmark } from './types';

const dest = (
  title: string,
  pageIndex: number,
  children?: OutlineBookmark[],
): OutlineBookmark => ({
  title,
  target: {
    type: 'destination',
    destination: { pageIndex },
  },
  children,
});

const header = (title: string, children?: OutlineBookmark[]): OutlineBookmark => ({
  title,
  children,
});

const uri = (title: string, url: string): OutlineBookmark => ({
  title,
  target: { type: 'action', action: { type: OutlineActionType.URI, uri: url } },
});

describe('resolveBookmarkPageIndex', () => {
  test('reads a direct destination target', () => {
    expect(resolveBookmarkPageIndex(dest('A', 4))).toBe(4);
  });

  test('reads a Goto action destination', () => {
    const bm: OutlineBookmark = {
      title: 'A',
      target: {
        type: 'action',
        action: {
          type: OutlineActionType.Goto,
          destination: { pageIndex: 7 },
        },
      },
    };
    expect(resolveBookmarkPageIndex(bm)).toBe(7);
  });

  test('returns undefined for URI actions', () => {
    expect(resolveBookmarkPageIndex(uri('Docs', 'https://example.com'))).toBeUndefined();
  });

  test('returns undefined for a header without a target', () => {
    expect(resolveBookmarkPageIndex(header('Part'))).toBeUndefined();
  });
});

describe('getActiveBookmarkPath', () => {
  const tree: OutlineBookmark[] = [
    dest('Chapter 1', 0, [dest('Section 1.1', 2), dest('Section 1.2', 5)]),
    dest('Chapter 2', 10),
  ];

  test('returns null when the page precedes the first bookmark', () => {
    expect(getActiveBookmarkPath([dest('Intro', 3)], 1)).toBeNull();
  });

  test('selects the top-level entry on its own page', () => {
    expect(getActiveBookmarkPath(tree, 0)).toEqual([0]);
  });

  test('selects the deepest heading at or before the page', () => {
    expect(getActiveBookmarkPath(tree, 2)).toEqual([0, 0]);
    expect(getActiveBookmarkPath(tree, 4)).toEqual([0, 0]);
    expect(getActiveBookmarkPath(tree, 6)).toEqual([0, 1]);
  });

  test('selects a later top-level entry once its page is reached', () => {
    expect(getActiveBookmarkPath(tree, 10)).toEqual([1]);
    expect(getActiveBookmarkPath(tree, 12)).toEqual([1]);
  });

  test('on a tie, the later entry in document order wins', () => {
    expect(getActiveBookmarkPath([dest('A', 3), dest('B', 3)], 3)).toEqual([1]);
  });

  test('skips target-less headers but selects their targeted children', () => {
    const t = [header('Part I', [dest('Chapter 1', 0)])];
    expect(getActiveBookmarkPath(t, 1)).toEqual([0, 0]);
  });

  test('ignores URI bookmarks when choosing the active entry', () => {
    const t = [dest('Home', 0), uri('External', 'https://example.com'), dest('End', 8)];
    expect(getActiveBookmarkPath(t, 4)).toEqual([0]);
  });
});
