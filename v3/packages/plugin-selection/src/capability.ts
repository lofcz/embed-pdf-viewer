import type { PageObjectNumber, PluginContext } from '@embedpdf-x/kernel';
import type { Point, Rect } from '@embedpdf-x/geometry';
import {
  buildPageText,
  expandToLine,
  expandToWord,
  glyphAt,
  rectsForRange,
  type PageText,
} from './geometry';
import type {
  GlyphPointer,
  SelectionAction,
  SelectionCapability,
  SelectionRange,
  SelectionState,
} from './types';

const EMPTY: Rect[] = [];

/**
 * The selection capability. The reducer state holds the selection range, the
 * derived content-space rects (per page), and per-page loaded flags; the (large,
 * non-serializable) per-page text geometry is cached HERE in the closure.
 *
 * Selection is cross-page: glyphs are ordered globally by (pageIndex, glyph), so
 * a drag from page 2 into page 4 selects the tail of 2, all of 3, and the head of
 * 4. `recompute` rebuilds the merged line rects for every loaded page in the span
 * and re-runs whenever a mid-span page finishes loading.
 */
export function createSelectionCapability(
  ctx: PluginContext<SelectionState, SelectionAction>,
): SelectionCapability {
  const cache = new Map<number, PageText>();
  const pending = new Set<number>();

  const pageIndexOf = (pon: PageObjectNumber): number =>
    ctx.document()?.pages.findIndex((p) => p.pageObjectNumber === pon) ?? -1;
  const ponAtIndex = (i: number): PageObjectNumber | undefined =>
    ctx.document()?.pages[i]?.pageObjectNumber;

  // Order the two ends of a selection by document position (page, then glyph).
  function orderedEnds(sel: SelectionRange): { start: GlyphPointer; end: GlyphPointer } {
    const ai = pageIndexOf(sel.anchor.pon);
    const fi = pageIndexOf(sel.focus.pon);
    const anchorFirst = ai < fi || (ai === fi && sel.anchor.glyph <= sel.focus.glyph);
    return anchorFirst
      ? { start: sel.anchor, end: sel.focus }
      : { start: sel.focus, end: sel.anchor };
  }

  function ensurePage(pon: PageObjectNumber): void {
    if (cache.has(pon) || pending.has(pon)) return;
    const doc = ctx.doc;
    const layout = ctx.document()?.pages.find((p) => p.pageObjectNumber === pon);
    if (!doc || !layout) return;
    pending.add(pon);
    doc
      .page(pon)
      .geometry.read()
      .then(
        (snapshot) => {
          pending.delete(pon);
          cache.set(
            pon,
            buildPageText(snapshot, layout.boxes.crop, layout.rotation, layout.userUnit),
          );
          ctx.dispatch({ type: 'PAGE_LOADED', pon });
          if (ctx.getState().selection) recompute(); // a mid-span page arrived → fill its rects
        },
        () => {
          pending.delete(pon); // doc closed / read aborted — ignore
        },
      );
  }

  // Rebuild merged line rects for every loaded page in the span; ensure the rest.
  function recompute(sel: SelectionRange | null = ctx.getState().selection): void {
    if (!sel) return;
    const { start, end } = orderedEnds(sel);
    const si = pageIndexOf(start.pon);
    const ei = pageIndexOf(end.pon);
    if (si < 0 || ei < 0) return;
    const rects: Record<number, Rect[]> = {};
    for (let i = si; i <= ei; i++) {
      const pon = ponAtIndex(i);
      if (pon == null) continue;
      const text = cache.get(pon);
      if (!text) {
        ensurePage(pon); // not loaded yet — it'll recompute when ready
        continue;
      }
      const from = i === si ? start.glyph : 0;
      const to = i === ei ? end.glyph : text.glyphs.length - 1;
      rects[pon] = rectsForRange(text, from, to);
    }
    ctx.dispatch({ type: 'SET', selection: sel, rects });
  }

  // Set the selection to a flat [from,to] glyph span on one page (word/line).
  function selectSpan(pon: PageObjectNumber, point: Point, expand: 'word' | 'line'): void {
    const text = cache.get(pon);
    if (!text) return;
    const i = glyphAt(text, point);
    if (i == null) return;
    const [from, to] = expand === 'word' ? expandToWord(text, i) : expandToLine(text, i);
    recompute({ anchor: { pon, glyph: from }, focus: { pon, glyph: to } });
  }

  return {
    ensurePage,

    isLoaded: (pon) => !!ctx.getState().loaded[pon],

    isOverText: (pon, point: Point) => {
      const text = cache.get(pon);
      return text ? glyphAt(text, point) != null : false;
    },

    beginAt: (pon, point: Point) => {
      const text = cache.get(pon);
      if (!text) return false;
      const i = glyphAt(text, point);
      if (i == null) return false; // not near text — caller deselects, doesn't capture
      recompute({ anchor: { pon, glyph: i }, focus: { pon, glyph: i } });
      return true;
    },

    selectWord: (pon, point: Point) => selectSpan(pon, point, 'word'),
    selectLine: (pon, point: Point) => selectSpan(pon, point, 'line'),

    extendTo: (pon, point: Point) => {
      const cur = ctx.getState().selection;
      if (!cur) return;
      const text = cache.get(pon);
      if (!text) {
        ensurePage(pon); // dragged onto a not-yet-loaded page — warm it, recompute on load
        return;
      }
      const i = glyphAt(text, point);
      if (i == null) return; // off-text — keep the last focus
      recompute({ anchor: cur.anchor, focus: { pon, glyph: i } });
    },

    end: () => {
      /* selection persists after the drag; nothing to finalize in v1 */
    },

    clear: () => ctx.dispatch({ type: 'CLEAR' }),

    rectsForPage: (pon) => ctx.getState().rects[pon] ?? EMPTY,

    hasSelection: () => ctx.getState().selection != null,
  };
}
