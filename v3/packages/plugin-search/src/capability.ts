import type { PageObjectNumber, PluginContext } from '@embedpdf-x/kernel';
import { applyRect, pageGeometry, type Rect, type RectIn } from '@embedpdf-x/geometry';
import { StageToken } from '@embedpdf-x/plugin-stage';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core/runtime';
import type {
  PdfRect,
  SearchMatch,
  SearchMode,
  SearchQuery,
  SearchSlice,
} from '@embedpdf/engine-core/runtime';

import type {
  SearchAction,
  SearchCapability,
  SearchHit,
  SearchOptions,
  SearchState,
} from './types';

const EMPTY: SearchHit[] = [];

/** Local engines reject a denied scope before the worker; cloud maps 403. */
const isPermissionDenied = (err: unknown): boolean =>
  (err instanceof Error && err.name === 'PermissionDenied') ||
  EngineError.is(err, EngineErrorCode.Forbidden);

/**
 * The search capability: a client-driven cursor loop over the engine's
 * budgeted slices. One generation counter arbitrates: a new `search()` (or
 * `clear()`, or a document mutation via `rerun()`) supersedes the running
 * loop, which aborts its in-flight slice and stops dispatching.
 *
 * Rect conversion happens HERE, once per slice: the engine's PDF-space
 * line rects → content space through the same page geometry the selection
 * plugin uses, so search highlights and selection highlights are pixel-twins.
 *
 * Stage integration is optional and additive: with a Stage present the scan
 * starts at the current page (viewport-first — the hits the user is looking
 * at arrive in the first slice) and `next()`/`prev()`/`goTo()` reveal the
 * hit's page. Without one, navigation still works; the host scrolls.
 */
export function createSearchCapability(
  ctx: PluginContext<SearchState, SearchAction>,
): SearchCapability {
  let generation = 0;
  let inflight: { abort(reason?: unknown): void } | null = null;
  let lastInput: { text: string; options: SearchOptions } | null = null;

  const toContent = (m: ReturnType<typeof pageGeometry>['pdfToContent'], b: PdfRect): Rect =>
    applyRect(
      m as never,
      {
        x: b.left,
        y: b.bottom,
        width: b.right - b.left,
        height: b.top - b.bottom,
      } as RectIn<'pdf'>,
    ) as Rect;

  interface PageConverter {
    pageIndex: number;
    toRect: (b: PdfRect) => Rect;
  }

  function hitsFromSlice(slice: SearchSlice): SearchHit[] {
    // zoom = 1: content space is scale-free; the layer applies the page
    // transform at render time (the selection idiom).
    const converters = new Map<PageObjectNumber, PageConverter | null>();
    const converterFor = (pon: PageObjectNumber): PageConverter | null => {
      let conv = converters.get(pon);
      if (conv !== undefined) return conv;
      const layout = ctx.document()?.pages.find((p) => p.pageObjectNumber === pon);
      if (!layout) {
        conv = null; // page vanished mid-search (delete); drop its hits
      } else {
        const { pdfToContent } = pageGeometry(
          { crop: layout.boxes.crop, rotation: layout.rotation, userUnit: layout.userUnit },
          1,
        );
        conv = { pageIndex: layout.index, toRect: (b) => toContent(pdfToContent, b) };
      }
      converters.set(pon, conv);
      return conv;
    };

    const hits: SearchHit[] = [];
    for (const match of slice.matches) {
      const conv = converterFor(match.pageObjectNumber);
      if (!conv) continue;
      hits.push({
        pon: match.pageObjectNumber,
        pageIndex: conv.pageIndex,
        charStart: match.charStart,
        charCount: match.charCount,
        rects: match.rects.map(conv.toRect),
        ...(match.snippet ? { snippet: match.snippet } : {}),
      });
    }
    return hits;
  }

  function buildQuery(text: string, options: SearchOptions): SearchQuery {
    return options.regex
      ? { kind: 'regex', pattern: text, matchCase: options.matchCase }
      : {
          kind: 'literal',
          text,
          matchCase: options.matchCase,
          matchDiacritics: options.matchDiacritics,
          wholeWord: options.wholeWord,
        };
  }

  async function run(text: string, options: SearchOptions): Promise<void> {
    const gen = ++generation;
    inflight?.abort('superseded');
    inflight = null;

    const doc = ctx.doc;
    if (!doc || text.length === 0) {
      ctx.dispatch({ type: 'CLEAR' });
      return;
    }

    const query = buildQuery(text, options);
    ctx.dispatch({ type: 'START', query });

    // Viewport-first: begin scanning where the user is looking.
    let startPage = options.startPage;
    if (startPage === undefined) {
      const stage = ctx.tryGet(StageToken);
      if (stage) startPage = ctx.document()?.pages[stage.currentPage()]?.pageObjectNumber;
    }

    let mode: SearchMode = 'full';
    let cursor: string | undefined;
    for (;;) {
      let slice: SearchSlice;
      try {
        const request = {
          query,
          mode,
          ...(cursor !== undefined ? { cursor } : startPage !== undefined ? { startPage } : {}),
        };
        const pending = doc.search.query(request);
        inflight = pending;
        slice = await pending;
      } catch (err) {
        if (gen !== generation) return; // superseded — the abort was ours
        // Snippets denied (no doc.text.copy)? Degrade to rect-only matches
        // instead of failing the whole search — find still works.
        if (mode === 'full' && cursor === undefined && isPermissionDenied(err)) {
          mode = 'rects';
          continue;
        }
        ctx.dispatch({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) });
        return;
      }
      if (gen !== generation) return;
      ctx.dispatch({
        type: 'APPEND',
        hits: hitsFromSlice(slice),
        scanned: slice.scannedPages,
        total: slice.totalPages,
      });
      if (slice.nextCursor === null) {
        inflight = null;
        ctx.dispatch({ type: 'COMPLETE' });
        return;
      }
      cursor = slice.nextCursor;
    }
  }

  function goTo(index: number): SearchHit | null {
    const { hits } = ctx.getState();
    if (hits.length === 0) return null;
    const wrapped = ((index % hits.length) + hits.length) % hits.length;
    ctx.dispatch({ type: 'SET_ACTIVE', index: wrapped });
    const hit = hits[wrapped];
    ctx.tryGet(StageToken)?.reveal(hit.pageIndex);
    return hit;
  }

  return {
    search: (text, options = {}) => {
      lastInput = { text, options };
      void run(text, options);
    },

    rerun: () => {
      if (lastInput && ctx.getState().status !== 'idle') {
        void run(lastInput.text, lastInput.options);
      }
    },

    clear: () => {
      generation++;
      inflight?.abort('cleared');
      inflight = null;
      lastInput = null;
      ctx.dispatch({ type: 'CLEAR' });
    },

    next: () => goTo(ctx.getState().activeIndex + 1),
    prev: () => goTo(ctx.getState().activeIndex - 1),
    goTo,

    status: () => ctx.getState().status,
    hits: () => ctx.getState().hits,
    hitCount: () => ctx.getState().hits.length,
    activeIndex: () => ctx.getState().activeIndex,
    activeHit: () => {
      const { hits, activeIndex } = ctx.getState();
      return activeIndex >= 0 && activeIndex < hits.length ? hits[activeIndex] : null;
    },
    hitsForPage: (pon) => {
      const { hits, hitsByPage } = ctx.getState();
      const indices = hitsByPage[pon];
      return indices?.length ? indices.map((i) => hits[i]) : EMPTY;
    },
    progress: () => ctx.getState().progress,
    errorMessage: () => ctx.getState().error,
  };
}
