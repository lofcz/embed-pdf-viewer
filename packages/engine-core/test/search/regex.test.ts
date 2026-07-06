import { describe, expect, test } from 'vitest';
import { SEARCH_REGEX_MAX_LENGTH, matchRegex, validateSearchRegex } from '../../src/shared';
import type { SearchRegexQuery } from '../../src/shared';

const q = (pattern: string, matchCase?: boolean): SearchRegexQuery => ({
  kind: 'regex',
  pattern,
  matchCase,
});

describe('validateSearchRegex', () => {
  test('accepts ordinary patterns', () => {
    expect(validateSearchRegex('\\d+').ok).toBe(true);
    expect(validateSearchRegex('foo|bar').ok).toBe(true);
    expect(validateSearchRegex('[a-z]{2,4}\\.pdf').ok).toBe(true);
    expect(validateSearchRegex('\\p{L}+').ok).toBe(true);
  });

  test('accepts named GROUPS (not to be confused with lookbehind)', () => {
    expect(validateSearchRegex('(?<year>\\d{4})').ok).toBe(true);
  });

  test('rejects backreferences', () => {
    const v = validateSearchRegex('(a)\\1');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issue).toBe('backreference');
  });

  test('rejects named backreferences', () => {
    const v = validateSearchRegex('(?<x>a)\\k<x>');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issue).toBe('backreference');
  });

  test('rejects lookahead and lookbehind', () => {
    for (const p of ['(?=x)y', '(?!x)y', '(?<=x)y', '(?<!x)y']) {
      const v = validateSearchRegex(p);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.issue).toBe('lookaround');
    }
  });

  test('rejects syntax errors, empty, and oversized patterns', () => {
    expect(validateSearchRegex('(')).toMatchObject({ ok: false, issue: 'syntax' });
    expect(validateSearchRegex('')).toMatchObject({ ok: false, issue: 'empty' });
    expect(validateSearchRegex('a'.repeat(SEARCH_REGEX_MAX_LENGTH + 1))).toMatchObject({
      ok: false,
      issue: 'too-long',
    });
  });

  test('escaped digits inside a character class are not backreferences', () => {
    // `[\1]` is a u-mode syntax error, not a backreference — the issue
    // must say so.
    const v = validateSearchRegex('[\\1]');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issue).toBe('syntax');
  });
});

describe('matchRegex', () => {
  test('finds all matches with original offsets', () => {
    expect(matchRegex('a 12 b 345', q('\\d+'))).toEqual([
      { start: 2, length: 2 },
      { start: 7, length: 3 },
    ]);
  });

  test('is case-insensitive by default; matchCase turns that off', () => {
    expect(matchRegex('FOO foo', q('foo'))).toEqual([
      { start: 0, length: 3 },
      { start: 4, length: 3 },
    ]);
    expect(matchRegex('FOO foo', q('foo', true))).toEqual([{ start: 4, length: 3 }]);
  });

  test('skips zero-length matches without looping forever', () => {
    expect(matchRegex('bbab', q('a*'))).toEqual([{ start: 2, length: 1 }]);
  });

  test('advances a full code point past empty matches on astral chars', () => {
    expect(matchRegex('\u{1F600}a', q('a*'))).toEqual([{ start: 2, length: 1 }]);
  });

  test('^ and $ match line boundaries (multiline page text)', () => {
    expect(matchRegex('ax\nbx', q('^b'))).toEqual([{ start: 3, length: 1 }]);
  });

  test('unicode property classes work (u-mode)', () => {
    expect(matchRegex('abc 123', q('\\p{L}+'))).toEqual([{ start: 0, length: 3 }]);
  });

  test('throws on dialect violations', () => {
    expect(() => matchRegex('x', q('(a)\\1'))).toThrow(/backreference/);
  });
});
