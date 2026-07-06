import type { PdfRect } from '../geometry/primitives';
import type { PageObjectNumber } from '../identity/PageObjectNumber';

/**
 * What to search for. A discriminated union because the two kinds carry
 * different knobs: literal queries fold (case/diacritics) and support
 * whole-word matching; regex queries run the RE2-compatible dialect
 * (see `validateSearchRegex`) against the raw page text, where only case
 * sensitivity applies.
 */
export type SearchQuery = SearchLiteralQuery | SearchRegexQuery;

export interface SearchLiteralQuery {
  kind: 'literal';
  text: string;
  /** Exact-case matching. Default false (case-folded). */
  matchCase?: boolean;
  /**
   * Treat diacritics as significant ("café" ≠ "cafe"). Default false —
   * marks are stripped on both sides, which is what viewers ship.
   */
  matchDiacritics?: boolean;
  /** Only match at word boundaries (letters/digits end the word). */
  wholeWord?: boolean;
}

export interface SearchRegexQuery {
  kind: 'regex';
  /**
   * Pattern in the portable search-regex dialect: JavaScript `u`-mode
   * syntax MINUS backreferences and lookaround, so every valid pattern
   * also runs on RE2 (the server-side engine). Validate client-side with
   * `validateSearchRegex` for early feedback; engines re-validate and
   * reject with `EngineErrorCode.InvalidArg`.
   */
  pattern: string;
  /** Exact-case matching. Default false (`i` semantics). */
  matchCase?: boolean;
}

/**
 * How much of a match leaves the engine — the permission story:
 *
 * - `'rects'` — page + highlight geometry only, no text. Needs
 *   `doc.text.search`. This is the mode for documents whose owners deny
 *   text extraction: the user can *find*, but nothing readable crosses
 *   the boundary.
 * - `'full'` — rects plus a context snippet per match. Needs
 *   `doc.text.search` AND `doc.text.copy` (a snippet IS extracted text).
 *
 * Engines reject a `'full'` request without the copy scope rather than
 * silently downgrading — the caller chooses the mode it renders.
 */
export type SearchMode = 'rects' | 'full';

/**
 * Per-slice spending caps. A slice ends as soon as EITHER cap is hit (or
 * the search space is exhausted). Engines clamp requested caps to their
 * own ceilings — the server never lets one request scan 40K pages.
 */
export interface SearchSliceBudget {
  /** Stop after this many matches (default: engine's ceiling). */
  maxMatches?: number;
  /** Stop after scanning this many pages (default: engine's ceiling). */
  maxPages?: number;
}

/**
 * One `query()` call = one bounded slice of work. Search over a large
 * document is a client-driven cursor loop — there is no server-side job
 * to start, poll, or cancel. Cancelling is simply not asking for the
 * next slice.
 */
export interface SearchRequest {
  query: SearchQuery;
  /** Default `'full'` (viewer UX); see {@link SearchMode} for gating. */
  mode?: SearchMode;
  /**
   * Resume token from the previous slice's `nextCursor`. Opaque — it
   * pins the query and position; the engine rejects a cursor replayed
   * against a different query or a mutated document with
   * `EngineErrorCode.InvalidArg` (re-issue from scratch).
   */
  cursor?: string;
  /**
   * Viewport-first ordering: start scanning at this page and wrap around
   * the document, so the matches the user is looking at arrive in the
   * first slice. Ignored when `cursor` is set (the cursor owns position).
   */
  startPage?: PageObjectNumber;
  /**
   * Trusted absolute resume position: pages of the scan order already
   * consumed. For callers that pin content versions EXTERNALLY — the
   * cloud wire pins the search content epoch in the URL, so its GET
   * routes resume by position alone. Everyone else should use `cursor`,
   * which also guards against mutations between slices; `cursor` takes
   * precedence when both are set.
   */
  skip?: number;
  budget?: SearchSliceBudget;
}

/**
 * Context around one match, `'full'` mode only. `text` is a short excerpt
 * of the page text with whitespace flattened 1:1 (offsets are preserved);
 * the match sits at `[matchStart, matchStart + matchLength)` within it —
 * highlight that range, never re-search the snippet.
 */
export interface SearchSnippet {
  text: string;
  matchStart: number;
  matchLength: number;
}

/**
 * One hit. `charStart`/`charCount` index the page's text-page character
 * space — the same space as `PageTextSnapshot.text` offsets and
 * `PageGeometryRun.charStart` — so a match joins the selection subsystem
 * (extend-selection-from-match, highlight annotations) without any
 * re-mapping. `rects` are merged line boxes in PDF user space (y-up),
 * built by the same line-merge as text selection — matches highlight
 * exactly like selections, one rect per visual line, never per glyph.
 */
export interface SearchMatch {
  pageObjectNumber: PageObjectNumber;
  charStart: number;
  charCount: number;
  rects: PdfRect[];
  snippet?: SearchSnippet;
}

/**
 * The result of one bounded slice. `nextCursor === null` means the search
 * space is exhausted — everything findable has been returned. Progress UI:
 * `scannedPages / totalPages` (scannedPages is cumulative across the
 * cursor chain, not per-slice).
 */
export interface SearchSlice {
  matches: SearchMatch[];
  nextCursor: string | null;
  scannedPages: number;
  totalPages: number;
}
