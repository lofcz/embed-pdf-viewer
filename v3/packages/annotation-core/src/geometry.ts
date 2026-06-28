/**
 * Pure content-space geometry, dispatched on the `Geom` union. This is the whole
 * per-kind surface: bounds, hit-testing (stroke + fill, with a configurable
 * margin), handles (with cursors), translate, handle-drag, and the dumb scene.
 * The PDF↔content bridge (crop-relative y-flip) is the only engine seam.
 */
import type { PdfPoint, PdfRect } from '@embedpdf/engine-core/runtime';
import {
  applyPoint,
  applyRect,
  invert,
  pdfToContentMatrix,
  type PointIn,
  type RectIn,
} from '@embedpdf-x/geometry';
import { cloudyBorderExtent, cloudyPath } from './cloudy';
import { endingNodes, endingPoints } from './endings';
import type {
  Border,
  Cursor,
  Geom,
  Handle,
  LineEnding,
  Quad,
  Rect,
  RenderNode,
  Style,
  Vec,
} from './types';

const MIN_SIZE = 4;

/* ── rect handles ─────────────────────────────────────────────────────────── */

export type RectHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const RECT_HANDLES: RectHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const RECT_CURSOR: Record<RectHandle, Cursor> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};
const rectEdges = (h: RectHandle) => ({
  w: h === 'nw' || h === 'w' || h === 'sw',
  e: h === 'ne' || h === 'e' || h === 'se',
  n: h === 'nw' || h === 'n' || h === 'ne',
  s: h === 'sw' || h === 's' || h === 'se',
});
const rectHandlePoint = (r: Rect, h: RectHandle): Vec => {
  const e = rectEdges(h);
  return {
    x: e.w ? r.x : e.e ? r.x + r.width : r.x + r.width / 2,
    y: e.n ? r.y : e.s ? r.y + r.height : r.y + r.height / 2,
  };
};
function resizeRect(base: Rect, h: RectHandle, to: Vec): Rect {
  const e = rectEdges(h);
  let l = base.x;
  let r = base.x + base.width;
  let t = base.y;
  let b = base.y + base.height;
  if (e.w) l = to.x;
  if (e.e) r = to.x;
  if (e.n) t = to.y;
  if (e.s) b = to.y;
  return {
    x: Math.min(l, r),
    y: Math.min(t, b),
    width: Math.max(MIN_SIZE, Math.abs(r - l)),
    height: Math.max(MIN_SIZE, Math.abs(b - t)),
  };
}

/* ── small math ───────────────────────────────────────────────────────────── */

export const rectFromPoints = (a: Vec, b: Vec): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(b.x - a.x),
  height: Math.abs(b.y - a.y),
});
export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
const rectContains = (r: Rect, p: Vec): boolean =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/** Distance from point p to segment ab. */
function segDist(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
/** Even-odd point-in-polygon. */
function pointInPoly(p: Vec, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
const polyPoints = (geom: Extract<Geom, { t: 'poly' }>): Vec[] => geom.points;

export function unionRect(pts: Vec[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

const expandRect = (r: Rect, pad: number): Rect => ({
  x: r.x - pad,
  y: r.y - pad,
  width: r.width + 2 * pad,
  height: r.height + 2 * pad,
});

/** Shrink a rect inward by `pad` on every side, staying centred and never
 *  collapsing past zero (a thick stroke on a tiny shape just yields a 0-extent
 *  path rather than an inverted one). The inverse of `expandRect` for shapes. */
const insetRect = (r: Rect, pad: number): Rect => {
  const width = Math.max(0, r.width - 2 * pad);
  const height = Math.max(0, r.height - 2 * pad);
  return { x: r.x + (r.width - width) / 2, y: r.y + (r.height - height) / 2, width, height };
};

/**
 * The stored `rect` for a freshly-drawn shape, given the box the user dragged. A
 * cloudy border stores the OUTER box (dragged + cloud extent), so the dragged box
 * is its inner edge and the scallops bulge out to the stored box — just like a
 * solid shape, whose /Rect is the dragged box. So `g.rect` is ALWAYS the outer box;
 * the cloud-vs-solid difference lives only here, at creation.
 */
export function shapeRectFor(dragged: Rect, ellipse: boolean, style: Style): Rect {
  return style.border.kind === 'cloudy'
    ? expandRect(dragged, cloudyBorderExtent(style.border.intensity, style.strokeWidth, ellipse))
    : dragged;
}

/* ── line endings ─────────────────────────────────────────────────────────────
 * The breathing room a stroked line/poly needs beyond its vertices, as a factor
 * of the stroke width (matches v2): the half-stroke under the centre-line plus a
 * little extra so caps/joins are never clipped by the engine `/Rect`.
 */
const ENDING_PAD = 1.2;

type EndingSeg = { tip: Vec; angle: number; ending: LineEnding | undefined };

/** The start/end tips of a line / open poly, each with the segment angle pointing
 *  OUT of the body into the tip (so an arrowhead opens back toward the line). */
function endingSegs(g: Geom): EndingSeg[] {
  if (g.t === 'line' && g.ends) {
    return [
      { tip: g.a, angle: Math.atan2(g.a.y - g.b.y, g.a.x - g.b.x), ending: g.ends.start },
      { tip: g.b, angle: Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x), ending: g.ends.end },
    ];
  }
  if (g.t === 'poly' && !g.closed && g.ends && g.points.length >= 2) {
    const p = g.points;
    const n = p.length;
    return [
      { tip: p[0], angle: Math.atan2(p[0].y - p[1].y, p[0].x - p[1].x), ending: g.ends.start },
      {
        tip: p[n - 1],
        angle: Math.atan2(p[n - 1].y - p[n - 2].y, p[n - 1].x - p[n - 2].x),
        ending: g.ends.end,
      },
    ];
  }
  return [];
}

/**
 * A geom's VISUAL bounds: the rect that encloses the drawn appearance, so the
 * baked /AP is never clipped and the selection outline wraps exactly what's drawn.
 *
 * A shape's `rect` IS its visual box (the PDF /Rect): solid/dashed strokes draw
 * inside it, and a cloudy border's scallops also inset back into it (the dragged
 * inner edge sits `/RD` in from it — see `shapeRectFor`). So growing the stroke or
 * the cloud thickens inward, never spilling past the handles. Lines / polylines /
 * ink have no box, so they expand by the stroke (+ endings) — the SAME math feeds
 * `geomScene`, so the visual box and what's drawn always agree.
 */
export function geomVisualBounds(g: Geom, strokeWidth: number): Rect {
  if (g.t === 'rect' || g.t === 'text') return g.rect;
  if (g.t === 'quads') return expandRect(unionRect(g.quads.flat()), strokeWidth / 2);
  if (g.t === 'ink') return expandRect(unionRect(g.strokes.flat()), strokeWidth / 2);
  const pts: Vec[] = g.t === 'line' ? [g.a, g.b] : [...g.points];
  for (const seg of endingSegs(g))
    pts.push(...endingPoints(seg.tip, seg.angle, seg.ending, strokeWidth));
  return expandRect(unionRect(pts), strokeWidth / 2 + ENDING_PAD * strokeWidth);
}

/**
 * The rect the SELECTION wraps — and the region a SELECTED annotation can be grabbed
 * from. Centre-line geometries (line / open polyline / ink) straddle their path, so
 * this is their VISUAL bounds (stroke + endings); shapes and closed polygons sit
 * tight on their box (so the 8 handles land on the corners). The chrome outline AND
 * the selected hit-test both call this, so what you see highlighted is exactly what
 * you can grab — they can never drift.
 */
export function selectionBounds(g: Geom, strokeWidth: number): Rect {
  return g.t === 'line' || g.t === 'ink' || (g.t === 'poly' && !g.closed)
    ? geomVisualBounds(g, strokeWidth)
    : geomBounds(g);
}

/**
 * Is the content point ON a line/poly's drawn ENDINGS — so an arrowhead is as
 * clickable as the stroke. Uses the SAME ending nodes the renderer draws: a closed
 * shape (closed arrow, circle, square, diamond) hits inside OR near its edge; an
 * open one (open arrow, butt, slash) hits near its stroke. `tol` is the stroke
 * band already widened by the hit margin.
 */
function endingHit(g: Geom, p: Vec, tol: number, strokeWidth: number): boolean {
  for (const seg of endingSegs(g)) {
    for (const node of endingNodes(seg.tip, seg.angle, seg.ending, strokeWidth)) {
      if (node.kind === 'ellipse') {
        const r = node.rect;
        const rx = r.width / 2;
        const ry = r.height / 2;
        if (rx <= 0 || ry <= 0) continue;
        const nx = (p.x - (r.x + rx)) / rx;
        const ny = (p.y - (r.y + ry)) / ry;
        if (Math.hypot(nx, ny) <= 1 + tol / Math.min(rx, ry)) return true; // filled disc + band
      } else if (node.kind === 'poly') {
        const pts = node.points;
        for (let i = 0; i < pts.length - 1; i++)
          if (segDist(p, pts[i], pts[i + 1]) <= tol) return true;
        if (node.closed) {
          if (pts.length > 2 && segDist(p, pts[pts.length - 1], pts[0]) <= tol) return true;
          if (pointInPoly(p, pts)) return true; // filled head interior
        }
      }
    }
  }
  return false;
}

/* ── geom ops ─────────────────────────────────────────────────────────────── */

export function geomBounds(g: Geom): Rect {
  if (g.t === 'rect' || g.t === 'text') return g.rect;
  if (g.t === 'line') return rectFromPoints(g.a, g.b);
  if (g.t === 'poly') return unionRect(g.points);
  if (g.t === 'ink') return unionRect(g.strokes.flat());
  return unionRect(g.quads.flat());
}

/**
 * Is the content point ON the annotation: within `margin` of the stroke, or
 * inside the fill (when `filled`). The stroke band widens with the stroke width.
 *
 * A shape's stroke is drawn INSIDE its box, centred on `insetRect(rect, sw/2)`
 * (see `geomScene`), so the clickable band follows that inset centre-line — not
 * the box edge. The fill still reaches the box. (Cloudy scallops aren't modelled
 * here; with their typically thin stroke the inset is sub-pixel, so this matches.)
 */
export function geomHit(
  g: Geom,
  p: Vec,
  margin: number,
  filled: boolean,
  strokeWidth: number,
): boolean {
  const tol = margin + strokeWidth / 2;
  // A text box is a solid hit target anywhere inside it (+ the click margin).
  if (g.t === 'text') return rectContains(expandRect(g.rect, margin), p);
  if (g.t === 'rect') {
    const r = g.rect;
    if (g.ellipse) {
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const orx = r.width / 2; // outer (box) radii — the fill reaches here
      const ory = r.height / 2;
      if (orx <= 0 || ory <= 0) return false;
      if (filled && Math.hypot((p.x - cx) / orx, (p.y - cy) / ory) <= 1) return true;
      // stroke band centred on the inset path (its outer edge sits on the box)
      const rx = Math.max(0.01, orx - strokeWidth / 2);
      const ry = Math.max(0.01, ory - strokeWidth / 2);
      const d = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
      const band = tol / Math.min(rx, ry); // approximate normalized stroke band
      return Math.abs(d - 1) <= band;
    }
    if (filled && rectContains(r, p)) return true;
    // near any of the 4 edges of the inset (drawn) rectangle
    const c = insetRect(r, strokeWidth / 2);
    const edges: [Vec, Vec][] = [
      [
        { x: c.x, y: c.y },
        { x: c.x + c.width, y: c.y },
      ],
      [
        { x: c.x + c.width, y: c.y },
        { x: c.x + c.width, y: c.y + c.height },
      ],
      [
        { x: c.x + c.width, y: c.y + c.height },
        { x: c.x, y: c.y + c.height },
      ],
      [
        { x: c.x, y: c.y + c.height },
        { x: c.x, y: c.y },
      ],
    ];
    return edges.some(([a, b]) => segDist(p, a, b) <= tol);
  }
  if (g.t === 'line') return segDist(p, g.a, g.b) <= tol || endingHit(g, p, tol, strokeWidth);
  if (g.t === 'poly') {
    if (filled && g.closed && pointInPoly(p, g.points)) return true;
    const pts = g.points;
    const n = pts.length;
    for (let i = 0; i < n - 1; i++) if (segDist(p, pts[i], pts[i + 1]) <= tol) return true;
    if (g.closed && n > 2 && segDist(p, pts[n - 1], pts[0]) <= tol) return true;
    return endingHit(g, p, tol, strokeWidth);
  }
  if (g.t === 'ink') {
    // near any segment of any stroke (ink is stroke-only, never filled)
    for (const stroke of g.strokes)
      for (let i = 0; i < stroke.length - 1; i++)
        if (segDist(p, stroke[i], stroke[i + 1]) <= tol) return true;
    return false;
  }
  // quads (markup): axis-aligned per-line rects — hit anywhere inside any quad.
  // (Use the quad's bbox: robust to the PDF /QuadPoints corner order, which is
  // UL,UR,LL,LR — a self-intersecting ring for a generic point-in-poly test.)
  return g.quads.some((q) => rectContains(unionRect(q), p));
}

export function geomHandles(g: Geom): Handle[] {
  if (g.t === 'rect' || g.t === 'text') {
    return RECT_HANDLES.map((h) => ({
      id: h,
      at: rectHandlePoint(g.rect, h),
      cursor: RECT_CURSOR[h],
    }));
  }
  if (g.t === 'line') {
    return [
      { id: 'v0', at: g.a, cursor: 'crosshair' },
      { id: 'v1', at: g.b, cursor: 'crosshair' },
    ];
  }
  if (g.t === 'poly') {
    return g.points.map((at, i) => ({ id: `v${i}`, at, cursor: 'crosshair' }));
  }
  return []; // markup: move only
}

export function geomTranslate(g: Geom, d: Vec): Geom {
  const mv = (p: Vec): Vec => ({ x: p.x + d.x, y: p.y + d.y });
  if (g.t === 'rect' || g.t === 'text')
    return { ...g, rect: { ...g.rect, x: g.rect.x + d.x, y: g.rect.y + d.y } };
  if (g.t === 'line') return { ...g, a: mv(g.a), b: mv(g.b) };
  if (g.t === 'poly') return { ...g, points: g.points.map(mv) };
  if (g.t === 'ink') return { ...g, strokes: g.strokes.map((s) => s.map(mv)) };
  return { ...g, quads: g.quads.map((q) => q.map(mv) as Quad) };
}

export function geomDragHandle(g: Geom, handle: string, to: Vec): Geom {
  if (g.t === 'rect' || g.t === 'text')
    return { ...g, rect: resizeRect(g.rect, handle as RectHandle, to) };
  if (g.t === 'line') return handle === 'v0' ? { ...g, a: to } : { ...g, b: to };
  if (g.t === 'poly') {
    const i = Number(handle.slice(1));
    if (!Number.isInteger(i) || i < 0 || i >= g.points.length) return g;
    const points = g.points.slice();
    points[i] = to;
    return { ...g, points };
  }
  return g;
}

export function geomScene(g: Geom, strokeWidth = 0, border?: Border): RenderNode[] {
  // A text box draws no vector nodes — the framework renders its editable element.
  if (g.t === 'text') return [];
  if (g.t === 'rect') {
    // A cloudy border's scallops inset back into `g.rect` (the OUTER box): the troughs
    // land at the dragged inner edge (`g.rect` − extent) and the peaks on `g.rect`.
    // Only drawn when the box can hold them — a box smaller than 2× the inset (e.g.
    // a 0-drag, or after cranking intensity) falls through to the plain outline.
    if (border?.kind === 'cloudy') {
      const inset = cloudyBorderExtent(border.intensity, strokeWidth, g.ellipse);
      if (g.rect.width > 2 * inset && g.rect.height > 2 * inset) {
        return [{ kind: 'path', d: cloudyPath(g.rect, g.ellipse, border.intensity, strokeWidth) }];
      }
    }
    // Otherwise the stroke sits INSIDE the box: inset the drawn path by half the
    // stroke so its outer edge lands on `g.rect`, not straddling it.
    const r = insetRect(g.rect, strokeWidth / 2);
    return [g.ellipse ? { kind: 'ellipse', rect: r } : { kind: 'rect', rect: r }];
  }
  if (g.t === 'line') {
    const nodes: RenderNode[] = [{ kind: 'line', a: g.a, b: g.b }];
    for (const seg of endingSegs(g))
      nodes.push(...endingNodes(seg.tip, seg.angle, seg.ending, strokeWidth));
    return nodes;
  }
  if (g.t === 'poly') {
    const nodes: RenderNode[] = [{ kind: 'poly', points: g.points, closed: g.closed }];
    for (const seg of endingSegs(g))
      nodes.push(...endingNodes(seg.tip, seg.angle, seg.ending, strokeWidth));
    return nodes;
  }
  if (g.t === 'ink') {
    // each pen stroke is an open polyline (stroke-only; `scene` paints it)
    return g.strokes.map((stroke) => ({ kind: 'poly', points: stroke, closed: false }));
  }
  // markup fallback: a closed ring per quad. Reorder UL,UR,LL,LR → UL,UR,LR,LL so
  // it's a simple (non-self-intersecting) rectangle. (The framework markup layer
  // renders these per-subtype; this keeps the generic scene correct regardless.)
  return g.quads.map((q) => ({ kind: 'poly', points: [q[0], q[1], q[3], q[2]], closed: true }));
}

/* ── PDF ↔ content bridge ─────────────────────────────────────────────────────
 * The ONE engine seam: PDF user space (y-up, crop bottom-left) ↔ content space
 * (y-down, crop top-left). The y-flip itself lives in `@embedpdf-x/geometry`
 * (`pdfToContentMatrix`) and is applied through its generic Mat2D primitives, so
 * this file never hand-rolls the rule. The only local work is bridging the
 * engine's edge-based `PdfRect` to geometry's corner+extent `RectIn`.
 * ──────────────────────────────────────────────────────────────────────────── */

const pdfRectToCorner = (r: PdfRect): RectIn<'pdf'> =>
  ({ x: r.left, y: r.bottom, width: r.right - r.left, height: r.top - r.bottom }) as RectIn<'pdf'>;
const cornerToPdfRect = (r: RectIn<'pdf'>): PdfRect => ({
  left: r.x,
  bottom: r.y,
  right: r.x + r.width,
  top: r.y + r.height,
});

export const pdfToContentPoint = (p: PdfPoint, crop: PdfRect): Vec =>
  applyPoint(pdfToContentMatrix(crop), p as PointIn<'pdf'>);
export const contentToPdfPoint = (p: Vec, crop: PdfRect): PdfPoint =>
  applyPoint(invert(pdfToContentMatrix(crop)), p as PointIn<'content'>);
export const pdfToContentRect = (pdf: PdfRect, crop: PdfRect): Rect =>
  applyRect(pdfToContentMatrix(crop), pdfRectToCorner(pdf));
export const contentToPdfRect = (r: Rect, crop: PdfRect): PdfRect =>
  cornerToPdfRect(applyRect(invert(pdfToContentMatrix(crop)), r as RectIn<'content'>));

/** A geom's VISUAL bounding box (geometry + stroke + line endings) as a PdfRect —
 *  the engine requires an explicit `rect` that encloses the baked /AP. */
export const geomPdfBounds = (g: Geom, strokeWidth: number, crop: PdfRect): PdfRect =>
  contentToPdfRect(geomVisualBounds(g, strokeWidth), crop);
