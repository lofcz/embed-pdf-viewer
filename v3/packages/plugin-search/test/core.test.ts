import { describe, expect, test } from 'vitest';
import { initialSearchState, searchReducer } from '../src/reducer';
import type { SearchHit, SearchState } from '../src/types';

const hit = (pon: number, charStart: number): SearchHit => ({
  pon,
  pageIndex: 0,
  charStart,
  charCount: 4,
  rects: [{ x: 0, y: 0, width: 10, height: 10 }],
});

const started = (): SearchState =>
  searchReducer(initialSearchState(), {
    type: 'START',
    query: { kind: 'literal', text: 'test' },
  });

describe('searchReducer', () => {
  test('START resets everything and enters searching', () => {
    const dirty: SearchState = {
      ...initialSearchState(),
      hits: [hit(5, 0)],
      hitsByPage: { 5: [0] },
      activeIndex: 0,
      status: 'complete',
    };
    const s = searchReducer(dirty, { type: 'START', query: { kind: 'literal', text: 'x' } });
    expect(s.status).toBe('searching');
    expect(s.hits).toEqual([]);
    expect(s.hitsByPage).toEqual({});
    expect(s.activeIndex).toBe(-1);
  });

  test('APPEND accumulates hits, indexes by page, activates the first hit', () => {
    let s = started();
    s = searchReducer(s, { type: 'APPEND', hits: [hit(5, 0), hit(5, 9)], scanned: 1, total: 8 });
    s = searchReducer(s, { type: 'APPEND', hits: [hit(7, 2)], scanned: 3, total: 8 });
    expect(s.hits.length).toBe(3);
    expect(s.hitsByPage).toEqual({ 5: [0, 1], 7: [2] });
    expect(s.activeIndex).toBe(0);
    expect(s.progress).toEqual({ scanned: 3, total: 8 });
  });

  test('an empty APPEND only advances progress', () => {
    let s = started();
    s = searchReducer(s, { type: 'APPEND', hits: [], scanned: 4, total: 8 });
    expect(s.hits.length).toBe(0);
    expect(s.activeIndex).toBe(-1);
    expect(s.progress.scanned).toBe(4);
  });

  test('APPEND keeps an explicit active index', () => {
    let s = started();
    s = searchReducer(s, { type: 'APPEND', hits: [hit(5, 0), hit(5, 9)], scanned: 1, total: 8 });
    s = searchReducer(s, { type: 'SET_ACTIVE', index: 1 });
    s = searchReducer(s, { type: 'APPEND', hits: [hit(7, 2)], scanned: 2, total: 8 });
    expect(s.activeIndex).toBe(1);
  });

  test('COMPLETE and ERROR set terminal status; CLEAR returns to idle', () => {
    let s = started();
    expect(searchReducer(s, { type: 'COMPLETE' }).status).toBe('complete');
    const failed = searchReducer(s, { type: 'ERROR', message: 'boom' });
    expect(failed.status).toBe('error');
    expect(failed.error).toBe('boom');
    expect(searchReducer(failed, { type: 'CLEAR' })).toEqual(initialSearchState());
  });
});
