import { describe, expect, it } from 'vitest';
import { firstHighlightedPageIndex, pageIndexIsHighlighted } from './page-highlights';

describe('pageIndexIsHighlighted', () => {
  it('matches inclusive 1-based ranges against a 0-based index', () => {
    const ranges = [
      { start: 31, end: 38 },
      { start: 11, end: 11 },
    ];
    expect(pageIndexIsHighlighted(30, ranges)).toBe(true);
    expect(pageIndexIsHighlighted(37, ranges)).toBe(true);
    expect(pageIndexIsHighlighted(10, ranges)).toBe(true);
    expect(pageIndexIsHighlighted(29, ranges)).toBe(false);
    expect(pageIndexIsHighlighted(38, ranges)).toBe(false);
  });

  it('returns false for missing or empty ranges', () => {
    expect(pageIndexIsHighlighted(0, undefined)).toBe(false);
    expect(pageIndexIsHighlighted(0, [])).toBe(false);
  });
});

describe('firstHighlightedPageIndex', () => {
  it('returns the first range start as a 0-based index', () => {
    expect(firstHighlightedPageIndex([{ start: 31, end: 38 }])).toBe(30);
  });

  it('returns null when there is no usable range', () => {
    expect(firstHighlightedPageIndex(undefined)).toBe(null);
    expect(firstHighlightedPageIndex([])).toBe(null);
    expect(firstHighlightedPageIndex([{ start: 0, end: 2 }])).toBe(null);
  });
});
