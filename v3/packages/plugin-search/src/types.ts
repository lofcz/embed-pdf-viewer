import { createCapabilityToken, type PageObjectNumber } from '@embedpdf-x/kernel';
import type { Rect } from '@embedpdf-x/geometry';
import type { SearchQuery, SearchSnippet } from '@embedpdf/engine-core/runtime';

/**
 * One match, viewer-shaped: the engine's PDF-space line rects converted to
 * CONTENT space (y-down — the same space selection rects live in), plus the
 * page's display index so navigation can `reveal()` without a lookup.
 * `charStart`/`charCount` keep the engine's text-page offsets, so a hit can
 * later seed a selection or a highlight annotation without re-searching.
 */
export interface SearchHit {
  pon: PageObjectNumber;
  pageIndex: number;
  charStart: number;
  charCount: number;
  rects: Rect[];
  snippet?: SearchSnippet;
}

/**
 * `searching` means the slice loop is still walking pages — results are
 * usable the moment they appear (matches stream in viewport-first order).
 */
export type SearchStatus = 'idle' | 'searching' | 'complete' | 'error';

/** UI-level options; `regex` switches the input from literal to pattern. */
export interface SearchOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  matchDiacritics?: boolean;
  regex?: boolean;
  /** Scan origin override. Defaults to the Stage's current page (viewport-first). */
  startPage?: PageObjectNumber;
}

export interface SearchState {
  /** The engine query in flight/completed, null when idle. */
  query: SearchQuery | null;
  status: SearchStatus;
  hits: SearchHit[];
  /** pon → indices into `hits` — the per-page layer's read model. */
  hitsByPage: Record<number, number[]>;
  /** Index into `hits`, -1 = none. */
  activeIndex: number;
  progress: { scanned: number; total: number };
  error: string | null;
}

export type SearchAction =
  | { type: 'START'; query: SearchQuery }
  | { type: 'APPEND'; hits: SearchHit[]; scanned: number; total: number }
  | { type: 'COMPLETE' }
  | { type: 'ERROR'; message: string }
  | { type: 'SET_ACTIVE'; index: number }
  | { type: 'CLEAR' };

export interface SearchCapability {
  /**
   * Start a new search (supersedes and aborts any running one). Results
   * stream into state slice by slice; the first hit becomes active but the
   * camera does NOT move until `next()`/`prev()`/`goTo()`.
   */
  search(text: string, options?: SearchOptions): void;
  /** Re-run the current query from scratch (used after document mutations). */
  rerun(): void;
  clear(): void;

  /** Advance to the next/previous hit (wraps) and reveal its page. */
  next(): SearchHit | null;
  prev(): SearchHit | null;
  /** Jump to a specific hit index and reveal its page. */
  goTo(index: number): SearchHit | null;

  status(): SearchStatus;
  hits(): SearchHit[];
  hitCount(): number;
  activeIndex(): number;
  activeHit(): SearchHit | null;
  /** Hits on one page — the layer's input. Element identity is stable. */
  hitsForPage(pon: PageObjectNumber): SearchHit[];
  progress(): { scanned: number; total: number };
  errorMessage(): string | null;
}

export const SearchToken = createCapabilityToken<SearchCapability>('search');
