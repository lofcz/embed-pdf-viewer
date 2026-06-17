/**
 * The bridge: engine text geometry (PDF user space, y-up edges) → viewer content
 * space (y-down, PDF units), plus glyph hit-testing and range→rects. All pure —
 * no DOM, no engine, no React. Selection is the first consumer to cross the
 * PDF↔content boundary, and it does it through the geometry package's
 * `pageGeometry` (the ONE place the crop-aware y-flip lives), never by hand.
 */
import { applyRect, pageGeometry, type Point, type Rect, type RectIn } from '@embedpdf-x/geometry';
import type { PageGeometrySnapshot, PdfRect } from '@embedpdf/engine-core/runtime';

const FLAG_SPACE = 1;
const FLAG_EMPTY = 2;

/** One glyph in content space, ready to hit-test and render. */
export interface GlyphInfo {
  rect: Rect;
  isSpace: boolean;
}

/**
 * Flatten a page's text geometry into content-space glyphs, in reading order.
 * `crop`/`rotation`/`userUnit` come from the page's `PageLayout`. Rotation does
 * NOT enter here — the overlay rides the page's CSS rotation, so glyphs stay in
 * un-rotated content space (the y-flip + crop origin is the only conversion).
 */
export function buildGlyphs(
  snapshot: PageGeometrySnapshot,
  crop: PdfRect,
  rotation: 0 | 90 | 180 | 270,
  userUnit: number,
): GlyphInfo[] {
  // zoom = 1: `pdfToContent` is scale-free (just the crop-relative y-flip), so the
  // viewer's zoom is applied later by PageTransform.pageToContent — not baked in.
  const { pdfToContent } = pageGeometry({ crop, rotation, userUnit }, 1);
  const out: GlyphInfo[] = [];
  for (const run of snapshot.runs) {
    for (const g of run.glyphs) {
      const b = g.looseBox; // PdfRect, y-up
      const pdf: RectIn<'pdf'> = {
        x: b.left,
        y: b.bottom,
        width: b.right - b.left,
        height: b.top - b.bottom,
      };
      out.push({
        rect: applyRect(pdfToContent, pdf) as Rect,
        isSpace: (g.flags & FLAG_SPACE) !== 0 || (g.flags & FLAG_EMPTY) !== 0,
      });
    }
  }
  return out;
}

/**
 * The glyph at a content-space point: exact containment first, else the nearest
 * glyph centre (so dragging into margins/leading still selects sensibly).
 */
export function glyphAt(glyphs: GlyphInfo[], p: Point): number | null {
  for (let i = 0; i < glyphs.length; i++) {
    const r = glyphs[i].rect;
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) return i;
  }
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < glyphs.length; i++) {
    const r = glyphs[i].rect;
    const dx = r.x + r.width / 2 - p.x;
    const dy = r.y + r.height / 2 - p.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best >= 0 ? best : null;
}

/**
 * Merge the glyphs in `[from, to]` into per-line content-space rects (consecutive
 * glyphs whose vertical centres line up are unioned into one rect).
 */
export function rectsForRange(glyphs: GlyphInfo[], from: number, to: number): Rect[] {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(glyphs.length - 1, Math.max(from, to));
  const out: Rect[] = [];
  let cur: Rect | null = null;
  let curMidY = 0;
  for (let i = lo; i <= hi; i++) {
    const r = glyphs[i].rect;
    const midY = r.y + r.height / 2;
    if (cur && Math.abs(midY - curMidY) <= r.height * 0.6) {
      const x1 = Math.min(cur.x, r.x);
      const y1 = Math.min(cur.y, r.y);
      const x2 = Math.max(cur.x + cur.width, r.x + r.width);
      const y2 = Math.max(cur.y + cur.height, r.y + r.height);
      cur = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    } else {
      if (cur) out.push(cur);
      cur = { x: r.x, y: r.y, width: r.width, height: r.height };
      curMidY = midY;
    }
  }
  if (cur) out.push(cur);
  return out;
}
