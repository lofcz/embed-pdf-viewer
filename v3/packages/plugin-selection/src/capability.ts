import type { PluginContext } from '@embedpdf-x/kernel';
import type { Point, Rect } from '@embedpdf-x/geometry';
import { buildGlyphs, glyphAt, rectsForRange, type GlyphInfo } from './geometry';
import type { SelectionAction, SelectionCapability, SelectionState } from './types';

const EMPTY: Rect[] = [];

/**
 * The selection capability. The reducer state holds the selection range, the
 * derived content-space rects, and per-page loaded flags; the (large, non-
 * serializable) per-page glyph geometry is cached HERE in the closure. Geometry
 * is read lazily from the engine handle — same pattern as plugin-render.
 */
export function createSelectionCapability(
  ctx: PluginContext<SelectionState, SelectionAction>,
): SelectionCapability {
  const cache = new Map<number, GlyphInfo[]>();
  const pending = new Set<number>();

  const computeRects = (pon: number, from: number, to: number): Record<number, Rect[]> => {
    const glyphs = cache.get(pon);
    return glyphs ? { [pon]: rectsForRange(glyphs, from, to) } : {};
  };

  return {
    ensurePage: (pon) => {
      if (cache.has(pon) || pending.has(pon)) return;
      const doc = ctx.doc;
      const meta = ctx.document();
      if (!doc || !meta) return;
      const layout = meta.pages.find((p) => p.pageObjectNumber === pon);
      if (!layout) return;
      pending.add(pon);
      doc
        .page(pon)
        .geometry.read()
        .then(
          (snapshot) => {
            pending.delete(pon);
            cache.set(
              pon,
              buildGlyphs(snapshot, layout.boxes.crop, layout.rotation, layout.userUnit),
            );
            ctx.dispatch({ type: 'PAGE_LOADED', pon });
          },
          () => {
            pending.delete(pon); // doc closed / read aborted — ignore
          },
        );
    },

    isLoaded: (pon) => !!ctx.getState().loaded[pon],

    beginAt: (pon, point: Point) => {
      const glyphs = cache.get(pon);
      if (!glyphs) return;
      const i = glyphAt(glyphs, point);
      if (i == null) return;
      ctx.dispatch({
        type: 'SET',
        selection: { anchor: { pon, glyph: i }, focus: { pon, glyph: i } },
        rects: computeRects(pon, i, i),
      });
    },

    extendTo: (pon, point: Point) => {
      const sel = ctx.getState().selection;
      if (!sel || sel.anchor.pon !== pon) return; // v1: single-page selection
      const glyphs = cache.get(pon);
      if (!glyphs) return;
      const i = glyphAt(glyphs, point);
      if (i == null) return;
      ctx.dispatch({
        type: 'SET',
        selection: { anchor: sel.anchor, focus: { pon, glyph: i } },
        rects: computeRects(pon, sel.anchor.glyph, i),
      });
    },

    end: () => {
      /* selection persists after the drag; nothing to finalize in v1 */
    },

    clear: () => ctx.dispatch({ type: 'CLEAR' }),

    rectsForPage: (pon) => ctx.getState().rects[pon] ?? EMPTY,

    hasSelection: () => ctx.getState().selection != null,
  };
}
