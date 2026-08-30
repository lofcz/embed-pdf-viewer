import { describe, expect, it } from 'vitest';
import {
  PAGE_CURRENT_MARKER,
  acceptPageDraft,
  commitPageDraft,
  splitPageLabel,
} from './page-input';

describe('acceptPageDraft', () => {
  it('allows an empty intermediate value', () => {
    expect(acceptPageDraft('', 165)).toBe('');
  });

  it('rejects non-digits', () => {
    expect(acceptPageDraft('12a', 165)).toBe(null);
    expect(acceptPageDraft('-1', 165)).toBe(null);
    expect(acceptPageDraft('1.5', 165)).toBe(null);
  });

  it('keeps in-range digits, including a leading zero', () => {
    expect(acceptPageDraft('2', 165)).toBe('2');
    expect(acceptPageDraft('0', 165)).toBe('0');
    expect(acceptPageDraft('119', 165)).toBe('119');
  });

  it('clamps overflow to the last page', () => {
    expect(acceptPageDraft('166', 165)).toBe('165');
    expect(acceptPageDraft('9999', 165)).toBe('165');
  });
});

describe('commitPageDraft', () => {
  it('restores the current page when the field is empty', () => {
    expect(commitPageDraft('', 165, 119)).toBe(119);
    expect(commitPageDraft('   ', 165, 119)).toBe(119);
  });

  it('clamps below 1 up to the first page', () => {
    expect(commitPageDraft('0', 165, 119)).toBe(1);
  });

  it('clamps above total down to the last page', () => {
    expect(commitPageDraft('200', 165, 119)).toBe(165);
  });

  it('keeps a valid page', () => {
    expect(commitPageDraft('42', 165, 119)).toBe(42);
  });
});

describe('splitPageLabel', () => {
  it('splits around the current-page marker', () => {
    expect(splitPageLabel(`Page ${PAGE_CURRENT_MARKER} of 165`)).toEqual({
      lead: 'Page ',
      tail: ' of 165',
    });
    expect(splitPageLabel(`Strana ${PAGE_CURRENT_MARKER} z 165`)).toEqual({
      lead: 'Strana ',
      tail: ' z 165',
    });
  });
});
