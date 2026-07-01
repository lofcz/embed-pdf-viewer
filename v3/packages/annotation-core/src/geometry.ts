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
  rotateAbout,
  type Mat2D,
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

const rectCornerPoints = (r: Rect): Vec[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x + r.width, y: r.y + r.height },
  { x: r.x, y: r.y + r.height },
];

/* ── rotation ──────────────────────────────────────────────────────────────
 * Annotation rotation, layered on the generic `@embedpdf-x/geometry` affine
 * primitives (`rotateAbout`). Box kinds carry an UNROTATED `rect` + a `rot`
 * angle; vertex kinds carry already-rotated points + an ADVISORY `rot`. These
 * helpers know that split and compose the matrix builders — they never hand-roll
 * a rotation matrix. See `Geom` in types.ts.
 * ──────────────────────────────────────────────────────────────────────────── */

const DEG2RAD = Math.PI / 180;

/** How far (content units) the rotate knob hangs off the top edge of the box. */
export const ROTATE_KNOB_OFFSET = 24;

/** Normalize degrees into `[0, 360)`. */
export const normalizeDeg = (d: number): number => ((d % 360) + 360) % 360;

/** A geom's applied rotation (deg), or 0 for the non-rotatable kinds. */
export function geomRotation(g: Geom): number {
  if (g.t === 'rect' || g.t === 'line' || g.t === 'poly' || g.t === 'ink' || g.t === 'text')
    return g.rot ?? 0;
  return 0;
}

const rectCenter = (r: Rect): Vec => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

const rotateAboutM = (pivot: Vec, deg: number): Mat2D<'content', 'content'> =>
  rotateAbout(pivot as PointIn<'content'>, deg * DEG2RAD);

const rotatePoint = (p: Vec, pivot: Vec, deg: number): Vec =>
  applyPoint(rotateAboutM(pivot, deg), p as PointIn<'content'>);

/**
 * The rotation PIVOT for a single shape: a box turns about its own `rect`
 * centre; a vertex shape about the CENTROID of its points (the mean). Rotating a
 * point set about its centroid leaves the centroid fixed, so the advisory `rot`
 * stays cleanly additive across gestures and reset is exact.
 */
export function centroidOf(g: Geom): Vec {
  if (g.t === 'rect' || g.t === 'text' || g.t === 'caret') return rectCenter(g.rect);
  if (g.t === 'line') return { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 };
  const pts = g.t === 'poly' ? g.points : g.t === 'ink' ? g.strokes.flat() : g.quads.flat();
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  const n = pts.length || 1;
  return { x: sx / n, y: sy / n };
}

/** Is this kind rotatable (the geometry carries a meaningful `rot`)? */
export function isRotatableGeom(g: Geom): boolean {
  return (
    g.t === 'rect' ||
    g.t === 'line' ||
    g.t === 'poly' ||
    g.t === 'ink' ||
    (g.t === 'text' && !g.callout)
  );
}

/**
 * Rotate a geom by `deltaDeg` (clockwise) about `pivot`.
 *  - BOX (`rect`/plain `text`): orbit the box centre about the pivot (a rigid
 *    translation of the unrotated `rect`) and add the angle to `rot`. When the
 *    pivot IS the box centre this is a pure `rot += delta`.
 *  - VERTEX (`line`/`poly`/`ink`): map every point through the rotation AND bump
 *    the advisory `rot` (the points stay the authoritative visual).
 * Non-rotatable kinds (caret/quads, callouts) are returned unchanged.
 */
export function geomRotateAbout(g: Geom, pivot: Vec, deltaDeg: number): Geom {
  if (deltaDeg === 0) return g;
  const nextRot = normalizeDeg(geomRotation(g) + deltaDeg);
  if (g.t === 'rect') {
    const c = rotatePoint(rectCenter(g.rect), pivot, deltaDeg);
    return {
      ...g,
      rect: { ...g.rect, x: c.x - g.rect.width / 2, y: c.y - g.rect.height / 2 },
      rot: nextRot,
    };
  }
  if (g.t === 'text') {
    if (g.callout) return g; // callout rotation is out of scope
    const c = rotatePoint(rectCenter(g.rect), pivot, deltaDeg);
    return {
      ...g,
      rect: { ...g.rect, x: c.x - g.rect.width / 2, y: c.y - g.rect.height / 2 },
      rot: nextRot,
    };
  }
  const rp = (p: Vec) => rotatePoint(p, pivot, deltaDeg);
  if (g.t === 'line') return { ...g, a: rp(g.a), b: rp(g.b), rot: nextRot };
  if (g.t === 'poly') return { ...g, points: g.points.map(rp), rot: nextRot };
  if (g.t === 'ink') return { ...g, strokes: g.strokes.map((s) => s.map(rp)), rot: nextRot };
  return g;
}

/** The AABB of `rect` rotated `deg` about its own centre. */
export function rotatedAabb(rect: Rect, deg: number): Rect {
  if (!deg) return rect;
  const c = rectCenter(rect);
  return unionRect(rectCornerPoints(rect).map((p) => rotatePoint(p, c, deg)));
}

/** Reset a geom to its as-authored orientation (`rot → 0`). Box: drop `rot`.
 *  Vertex: spin the points by `-rot` about their centroid so they return to the
 *  orientation they were drawn at, in place. */
export function geomResetRotation(g: Geom): Geom {
  const rot = geomRotation(g);
  if (!rot) return g;
  if (g.t === 'rect' || g.t === 'text') return { ...g, rot: 0 };
  const c = centroidOf(g);
  const rotated = geomRotateAbout(g, c, -rot);
  // geomRotateAbout already set rot = normalize(rot - rot) = 0.
  return rotated;
}

/**
 * The oriented selection box (OBB) of a rotatable geom: four corners (in order
 * nw, ne, se, sw of the LOCAL box, transformed) + the angle. For a box this is
 * the `rect` rotated about its centre; for a vertex shape it is reconstructed
 * from the advisory `rot` — un-rotate the points to recover the as-authored
 * shape, take that tight local box, then rotate it back — giving the snug tilted
 * rectangle. Returns null for non-rotatable kinds.
 */
export function obbFromGeom(
  g: Geom,
  strokeWidth: number,
): { corners: [Vec, Vec, Vec, Vec]; angle: number } | null {
  if (!isRotatableGeom(g)) return null;
  const rot = geomRotation(g);
  if (g.t === 'rect' || g.t === 'text') {
    const c = rectCenter(g.rect);
    const corners = rectCornerPoints(g.rect).map((p) => rotatePoint(p, c, rot));
    return { corners: corners as [Vec, Vec, Vec, Vec], angle: rot };
  }
  // vertex: reconstruct the local (as-authored) box from rot about the centroid.
  const c = centroidOf(g);
  const unrotated = rot ? geomRotateAbout(g, c, -rot) : g;
  const localBox = selectionBounds(unrotated, strokeWidth);
  const corners = rectCornerPoints(localBox).map((p) => rotatePoint(p, c, rot));
  return { corners: corners as [Vec, Vec, Vec, Vec], angle: rot };
}

/* ── group (multi-target) scaling ─────────────────────────────────────────────
 * A multi-selection scales as one box about a fixed anchor (the opposite handle
 * corner/edge). Resize is ANISOTROPIC only when every member has `rot == 0`
 * (otherwise an off-axis scale would shear a rotated shape it can't represent —
 * so we fall back to a uniform scale). The iso/aniso choice is decided by the
 * caller (it needs the live selection); these helpers take the resolved factors.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The 8 box resize handles (corner + edge, with cursors) of a plain rect — used
 *  for the multi-target group box. */
export function rectHandlesFor(r: Rect): Handle[] {
  return RECT_HANDLES.map((h) => ({ id: h, at: rectHandlePoint(r, h), cursor: RECT_CURSOR[h] }));
}

/** The fixed point of a group resize: the OPPOSITE handle's point on the box. */
export function groupResizeAnchor(base: Rect, handle: string): Vec {
  return rectHandlePoint(base, OPPOSITE_HANDLE[handle as RectHandle] ?? 'nw');
}

/**
 * The live group resize box for a drag. Anisotropic = the plain axis-aligned
 * `resizeRect`; isotropic = a uniform scale of `base` about the anchor by the
 * larger of the two drag ratios (so the preview matches the committed scale and
 * never shears a rotated member).
 */
export function groupResizeBox(base: Rect, handle: string, to: Vec, isotropic: boolean): Rect {
  const raw = resizeRect(base, handle as RectHandle, to);
  if (!isotropic) return raw;
  const sx = base.width > 0 ? raw.width / base.width : 1;
  const sy = base.height > 0 ? raw.height / base.height : 1;
  const s = Math.max(MIN_SIZE / Math.max(base.width, base.height, 1), Math.max(sx, sy));
  const anchor = groupResizeAnchor(base, handle);
  return {
    x: anchor.x + (base.x - anchor.x) * s,
    y: anchor.y + (base.y - anchor.y) * s,
    width: base.width * s,
    height: base.height * s,
  };
}

/** The (sx, sy) factors a `base`→`cur` group resize applied about its anchor. */
export function groupResizeFactors(base: Rect, cur: Rect): { sx: number; sy: number } {
  return {
    sx: base.width > 0 ? cur.width / base.width : 1,
    sy: base.height > 0 ? cur.height / base.height : 1,
  };
}

/**
 * Scale a geom about `anchor` by `(sx, sy)`. For a rotated box (iso scale, so
 * `sx === sy`) the unrotated `rect` is scaled about the anchor and `rot` is
 * preserved (a uniform scale commutes with rotation). For unrotated members
 * (the anisotropic case) every point/extent scales directly.
 */
export function geomScaleAbout(g: Geom, anchor: Vec, sx: number, sy: number): Geom {
  const sp = (p: Vec): Vec => ({
    x: anchor.x + (p.x - anchor.x) * sx,
    y: anchor.y + (p.y - anchor.y) * sy,
  });
  if (g.t === 'rect' || g.t === 'text') {
    if (g.t === 'text' && g.callout) return g;
    const c = sp(rectCenter(g.rect));
    const w = Math.max(MIN_SIZE, g.rect.width * Math.abs(sx));
    const h = Math.max(MIN_SIZE, g.rect.height * Math.abs(sy));
    return { ...g, rect: { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h } };
  }
  if (g.t === 'line') return { ...g, a: sp(g.a), b: sp(g.b) };
  if (g.t === 'poly') return { ...g, points: g.points.map(sp) };
  if (g.t === 'ink') return { ...g, strokes: g.strokes.map((s) => s.map(sp)) };
  if (g.t === 'caret') {
    const c = sp(rectCenter(g.rect));
    const w = Math.max(MIN_SIZE, g.rect.width * Math.abs(sx));
    const h = Math.max(MIN_SIZE, g.rect.height * Math.abs(sy));
    return { ...g, rect: { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h } };
  }
  return g; // quads scale with their points
}

/** Where the rotate knob sits, given the OBB corners (nw, ne, se, sw) and the
 *  outward offset (content units). `from` is the top-edge midpoint the connector
 *  stalk anchors to; `at` is the grab dot, offset along the outward normal. */
export function rotateKnob(corners: [Vec, Vec, Vec, Vec], offset: number): { at: Vec; from: Vec } {
  const [nw, ne, , sw] = corners;
  const from = { x: (nw.x + ne.x) / 2, y: (nw.y + ne.y) / 2 };
  // outward normal = from the bottom edge toward the top edge (away from shape).
  const down = { x: sw.x - nw.x, y: sw.y - nw.y };
  const len = Math.hypot(down.x, down.y) || 1;
  const up = { x: -down.x / len, y: -down.y / len };
  return { at: { x: from.x + up.x * offset, y: from.y + up.y * offset }, from };
}

/* ── callout leader ───────────────────────────────────────────────────────────
 * A free-text callout draws a 2–3 point leader (`/CL`) from the called-out `tip`
 * to the text box, with an arrow (`/LE`) at the tip. The point where the leader
 * meets the box is DERIVED — never stored — so it tracks the box and knee.
 */

/** The box-edge midpoint the leader connects to: the side `ref` (the knee, else
 *  the tip) points toward, by horizontal/vertical dominance vs the box centre.
 *  Mirror of v2's `computeCalloutConnectionPoint`. */
export function calloutConnection(box: Rect, ref: Vec): Vec {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = ref.x - cx;
  const dy = ref.y - cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { x: box.x + box.width, y: cy } : { x: box.x, y: cy };
  }
  return dy >= 0 ? { x: cx, y: box.y + box.height } : { x: cx, y: box.y };
}

/** The leader polyline `[tip, knee?, conn]`, with `conn` derived from the box. */
export function calloutLinePoints(g: Extract<Geom, { t: 'text' }>): Vec[] {
  const c = g.callout;
  if (!c) return [];
  const conn = calloutConnection(g.rect, c.knee ?? c.tip);
  return c.knee ? [c.tip, c.knee, conn] : [c.tip, conn];
}

/** The leader's single ending segment (arrow at the tip), pointing OUT of the
 *  body into the tip — so the arrowhead opens back along the leader. */
function calloutEndingSeg(pts: Vec[], ending: LineEnding): EndingSeg | null {
  if (pts.length < 2) return null;
  return {
    tip: pts[0],
    angle: Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x),
    ending,
  };
}

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

export function caretRectFromTextEnd(lineRect: Rect): Rect {
  const height = lineRect.height / 2;
  const width = height;
  const lineEndX = lineRect.x + lineRect.width;
  return {
    x: lineEndX - width / 2,
    y: lineRect.y + lineRect.height / 2,
    width,
    height,
  };
}

/* ── line endings ─────────────────────────────────────────────────────────────
 * The breathing room a stroked line/poly needs beyond its vertices, as a factor
 * of the stroke width (matches v2): the half-stroke under the centre-line plus a
 * little extra so caps/joins are never clipped by the engine `/Rect`.
 */
/** Miter limit shared by the bounds math AND the SVG renderer (`stroke-miterlimit`),
 *  so the computed box and the drawn stroke always agree on where a sharp join
 *  bevels instead of spiking. 10 = the PDF default (also what the baked /AP uses). */
export const MITER_LIMIT = 10;

/**
 * The outline points of a mitred, butt-capped polyline (open or closed) stroked
 * at `strokeWidth`: each segment's two side offsets (the straight extents + both
 * bevel corners) PLUS each interior join's OUTER miter tip — added only while the
 * join is within `MITER_LIMIT` (past that the renderer bevels it, and the segment
 * offsets already bound it). `unionRect` of these is the tight, ASYMMETRIC visual
 * box: a pointy join grows the box only on the side it actually spikes.
 *
 * Miter kinds only (line / polyline / polygon). Ink is round-capped/round-joined,
 * never spikes, and is bounded elsewhere by a plain `h` grow.
 */
function strokeOutlinePoints(pts: Vec[], closed: boolean, strokeWidth: number): Vec[] {
  const h = strokeWidth / 2;
  const n = pts.length;
  if (n === 0) return [];
  if (n === 1 || h === 0) return [...pts];

  const segCount = closed ? n : n - 1;
  const dir: Vec[] = [];
  const nrm: Vec[] = [];
  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    dir.push({ x: ux, y: uy });
    nrm.push({ x: -uy, y: ux }); // a unit normal (either side; sign is re-picked below)
  }

  const out: Vec[] = [];
  // Segment side offsets at both ends — covers the straight extents, the butt
  // caps at open ends, and the bevel corners of any beveled join.
  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const nx = nrm[i].x * h;
    const ny = nrm[i].y * h;
    out.push({ x: a.x + nx, y: a.y + ny }, { x: a.x - nx, y: a.y - ny });
    out.push({ x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny });
  }

  // Interior joins: the outer miter tip, gated by the miter limit.
  const joinStart = closed ? 0 : 1;
  const joinEnd = closed ? n : n - 1; // vertices [joinStart, joinEnd)
  for (let v = joinStart; v < joinEnd; v++) {
    const inIdx = closed ? (v - 1 + n) % n : v - 1;
    const outIdx = closed ? v : v; // segment starting at v
    const a = dir[inIdx]; // prev -> v
    const b = dir[outIdx]; // v -> next
    const n1 = nrm[inIdx];
    const n2 = nrm[outIdx];
    // Outer bisector direction: opposite the interior bisector `b - a`.
    const bx = a.x - b.x;
    const by = a.y - b.y;
    if (Math.hypot(bx, by) < 1e-9) continue; // straight run: no spike beyond the offsets
    let mhx = n1.x + n2.x;
    let mhy = n1.y + n2.y;
    const ml = Math.hypot(mhx, mhy);
    if (ml < 1e-9) continue; // exact hairpin: renderer bevels
    mhx /= ml;
    mhy /= ml;
    if (mhx * bx + mhy * by < 0) {
      mhx = -mhx; // point the miter unit vector to the OUTER side
      mhy = -mhy;
    }
    const cosHalf = Math.abs(mhx * n1.x + mhy * n1.y); // cos(deviation/2)
    if (cosHalf < 1e-9) continue;
    const miterLen = h / cosHalf;
    if (miterLen > MITER_LIMIT * h) continue; // too sharp: renderer bevels → offsets bound it
    const V = pts[v];
    out.push({ x: V.x + mhx * miterLen, y: V.y + mhy * miterLen });
  }
  return out;
}

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
  if (g.t === 'text' && g.callout) {
    // The overall /Rect: the union of the text box, the leader points, and the
    // arrow-ending polygon at the tip (same ending math as line/poly).
    const pts = calloutLinePoints(g);
    const seg = calloutEndingSeg(pts, g.callout.ending);
    const all = [...rectCornerPoints(g.rect), ...pts];
    if (seg) all.push(...endingPoints(seg.tip, seg.angle, seg.ending, strokeWidth));
    return expandRect(unionRect(all), strokeWidth / 2);
  }
  if (g.t === 'rect' || g.t === 'text' || g.t === 'caret') return g.rect;
  if (g.t === 'quads') return expandRect(unionRect(g.quads.flat()), strokeWidth / 2);
  // Ink is round-capped/round-joined: it never spikes, so a plain `h` grow of the
  // freehand hull is exact — left as-is (the freehand look must not change).
  if (g.t === 'ink') return expandRect(unionRect(g.strokes.flat()), strokeWidth / 2);
  // Line / polyline / polygon: the miter kinds. Wrap the ACTUAL stroke outline
  // (per-join, asymmetric) instead of a flat pad, then union the endings' own box
  // (their centre-line points grown by `h` for the ending's stroke).
  const raw = g.t === 'line' ? [g.a, g.b] : g.points;
  const closed = g.t === 'poly' && g.closed;
  const box = unionRect(strokeOutlinePoints(raw, closed, strokeWidth));
  const endPts: Vec[] = [];
  for (const seg of endingSegs(g))
    endPts.push(...endingPoints(seg.tip, seg.angle, seg.ending, strokeWidth));
  if (!endPts.length) return box;
  const endBox = expandRect(unionRect(endPts), strokeWidth / 2);
  return unionRect([...rectCornerPoints(box), ...rectCornerPoints(endBox)]);
}

/**
 * The rect the SELECTION wraps — and the region a SELECTED annotation can be grabbed
 * from. Centre-line geometries (line / polyline / polygon / ink) straddle their path,
 * so this is their VISUAL bounds (the join-aware stroke outline + endings) — a
 * polygon's outline wraps its stroke exactly like a polyline. Box kinds (square /
 * circle / free-text) sit tight on their `rect` (their stroke draws INSIDE the box,
 * so the 8 resize handles land on the corners). The chrome outline AND the selected
 * hit-test both call this, so what you see highlighted is exactly what you can grab —
 * they can never drift.
 */
export function selectionBounds(g: Geom, strokeWidth: number): Rect {
  return g.t === 'line' || g.t === 'ink' || g.t === 'poly'
    ? geomVisualBounds(g, strokeWidth)
    : geomBounds(g);
}

/**
 * The four corners of the ORIENTED selection box — the SAME quad `chrome` draws.
 * For a rotatable kind this is the OBB (the tilted box, from `obbFromGeom`); at
 * `rot == 0` those are just the axis-aligned corners of `selectionBounds`, and
 * for non-rotatable kinds (markup quads, callouts) it falls back to the rect
 * corners. The grab region, the floating-menu anchor and the multi/group union
 * all consume this, so what you can grab / where the menu sits never drifts from
 * the outline you see.
 */
export function selectionQuad(g: Geom, strokeWidth: number): [Vec, Vec, Vec, Vec] {
  const obb = obbFromGeom(g, strokeWidth);
  if (obb) return obb.corners;
  return rectCornerPoints(selectionBounds(g, strokeWidth)) as [Vec, Vec, Vec, Vec];
}

/** Is the point inside the (convex) selection quad? Even-odd ring test. */
export const pointInQuad = (p: Vec, quad: [Vec, Vec, Vec, Vec]): boolean => pointInPoly(p, quad);

/**
 * The centre of the ORIENTED selection box — the middle of the rect you see.
 * For box kinds this is the rect centre (so squares/circles are unchanged); for
 * vertex kinds it is the OBB centre, so rotation spins the shape in place rather
 * than swinging it about the off-centre vertex mean (`centroidOf`).
 */
export function selectionCenter(g: Geom, strokeWidth: number): Vec {
  const q = selectionQuad(g, strokeWidth);
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  };
}

/**
 * Is the content point ON a line/poly's drawn ENDINGS — so an arrowhead is as
 * clickable as the stroke. Uses the SAME ending nodes the renderer draws: a closed
 * shape (closed arrow, circle, square, diamond) hits inside OR near its edge; an
 * open one (open arrow, butt, slash) hits near its stroke. `tol` is the stroke
 * band already widened by the hit margin.
 */
function endingNodesHit(nodes: RenderNode[], p: Vec, tol: number): boolean {
  for (const node of nodes) {
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
  return false;
}

function endingHit(g: Geom, p: Vec, tol: number, strokeWidth: number): boolean {
  for (const seg of endingSegs(g))
    if (endingNodesHit(endingNodes(seg.tip, seg.angle, seg.ending, strokeWidth), p, tol))
      return true;
  return false;
}

/* ── geom ops ─────────────────────────────────────────────────────────────── */

export function geomBounds(g: Geom): Rect {
  if (g.t === 'rect' || g.t === 'text' || g.t === 'caret') return g.rect;
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
  // A rotated box stores its UNROTATED `rect`; inverse-rotate the pointer into
  // that local frame and run the normal axis-aligned tests. Vertex kinds carry
  // already-rotated points, so they hit-test directly (rot is advisory).
  if ((g.t === 'rect' || (g.t === 'text' && !g.callout)) && (g.rot ?? 0) !== 0) {
    p = rotatePoint(p, rectCenter(g.rect), -(g.rot ?? 0));
  }
  // A text box is a solid hit target anywhere inside it (+ the click margin).
  if (g.t === 'caret') return rectContains(expandRect(g.rect, margin), p);
  if (g.t === 'text') {
    if (rectContains(expandRect(g.rect, margin), p)) return true;
    if (g.callout) {
      const pts = calloutLinePoints(g);
      for (let i = 0; i < pts.length - 1; i++)
        if (segDist(p, pts[i], pts[i + 1]) <= tol) return true;
      const seg = calloutEndingSeg(pts, g.callout.ending);
      if (seg && endingNodesHit(endingNodes(seg.tip, seg.angle, seg.ending, strokeWidth), p, tol))
        return true;
    }
    return false;
  }
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
    const rot = g.t === 'text' && g.callout ? 0 : (g.rot ?? 0);
    const c = rectCenter(g.rect);
    const handles: Handle[] = RECT_HANDLES.map((h) => ({
      id: h,
      // box handles sit on the UNROTATED rect; rotate each into place so they
      // ride the tilted box.
      at: rot ? rotatePoint(rectHandlePoint(g.rect, h), c, rot) : rectHandlePoint(g.rect, h),
      cursor: RECT_CURSOR[h],
    }));
    // A callout adds vertex handles for the leader tip and (if present) knee, so
    // the called-out point and the elbow can be dragged independently of the box.
    if (g.t === 'text' && g.callout) {
      handles.push({ id: 'callout-tip', at: g.callout.tip, cursor: 'crosshair' });
      if (g.callout.knee)
        handles.push({ id: 'callout-knee', at: g.callout.knee, cursor: 'crosshair' });
    }
    return handles;
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
  if (g.t === 'text') {
    const rect = { ...g.rect, x: g.rect.x + d.x, y: g.rect.y + d.y };
    if (!g.callout) return { ...g, rect };
    return {
      ...g,
      rect,
      callout: {
        ...g.callout,
        tip: mv(g.callout.tip),
        knee: g.callout.knee ? mv(g.callout.knee) : undefined,
      },
    };
  }
  if (g.t === 'rect' || g.t === 'caret')
    return { ...g, rect: { ...g.rect, x: g.rect.x + d.x, y: g.rect.y + d.y } };
  if (g.t === 'line') return { ...g, a: mv(g.a), b: mv(g.b) };
  if (g.t === 'poly') return { ...g, points: g.points.map(mv) };
  if (g.t === 'ink') return { ...g, strokes: g.strokes.map((s) => s.map(mv)) };
  return { ...g, quads: g.quads.map((q) => q.map(mv) as Quad) };
}

const OPPOSITE_HANDLE: Record<RectHandle, RectHandle> = {
  nw: 'se',
  ne: 'sw',
  se: 'nw',
  sw: 'ne',
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
};

/**
 * Resize a ROTATED box by `handle`, keeping the opposite corner/edge fixed in
 * WORLD space. The pointer is mapped into the box's local (unrotated) frame, the
 * axis-aligned `resizeRect` runs there, then the new box is repositioned so the
 * anchor (the opposite handle's point) lands back where it was — and the box
 * still rotates about its OWN centre. With `rot === 0` this is exactly the plain
 * `resizeRect`.
 */
function resizeRotatedRect(base: Rect, rot: number, handle: RectHandle, to: Vec): Rect {
  if (!rot) return resizeRect(base, handle, to);
  const c0 = rectCenter(base);
  const localTo = rotatePoint(to, c0, -rot);
  const next = resizeRect(base, handle, localTo);
  const anchorLocal = rectHandlePoint(base, OPPOSITE_HANDLE[handle]);
  const anchorWorld = rotatePoint(anchorLocal, c0, rot);
  const nextCenterLocal = rectCenter(next);
  // offset of the anchor from the new centre, in the local frame; rotate it to
  // world orientation and place the new centre so the anchor stays put.
  const offX = anchorLocal.x - nextCenterLocal.x;
  const offY = anchorLocal.y - nextCenterLocal.y;
  const rad = rot * DEG2RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rOffX = cos * offX - sin * offY;
  const rOffY = sin * offX + cos * offY;
  const cx = anchorWorld.x - rOffX;
  const cy = anchorWorld.y - rOffY;
  return {
    x: cx - next.width / 2,
    y: cy - next.height / 2,
    width: next.width,
    height: next.height,
  };
}

export function geomDragHandle(g: Geom, handle: string, to: Vec): Geom {
  if (g.t === 'text') {
    if (handle === 'callout-tip' && g.callout) return { ...g, callout: { ...g.callout, tip: to } };
    if (handle === 'callout-knee' && g.callout)
      return { ...g, callout: { ...g.callout, knee: to } };
    return { ...g, rect: resizeRotatedRect(g.rect, g.rot ?? 0, handle as RectHandle, to) };
  }
  if (g.t === 'rect')
    return { ...g, rect: resizeRotatedRect(g.rect, g.rot ?? 0, handle as RectHandle, to) };
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
  // A plain text box draws no vector nodes — the framework renders its editable
  // element. A callout still draws its leader (open polyline) + arrow at the tip,
  // plus a stroke-only box border (the DOM owns the text + background).
  if (g.t === 'text') {
    if (!g.callout) return [];
    const pts = calloutLinePoints(g);
    const nodes: RenderNode[] = [{ kind: 'poly', points: pts, closed: false }];
    const seg = calloutEndingSeg(pts, g.callout.ending);
    if (seg) nodes.push(...endingNodes(seg.tip, seg.angle, seg.ending, strokeWidth));
    if (strokeWidth > 0) nodes.push({ kind: 'rect', rect: g.rect });
    return nodes;
  }
  if (g.t === 'caret') {
    const r = g.rect;
    const midX = r.x + r.width / 2;
    const bottom = r.y + r.height;
    const d = [
      `M ${r.x} ${bottom}`,
      `C ${r.x + r.width * 0.27} ${bottom} ${midX} ${r.y + r.height * 0.56} ${midX} ${r.y}`,
      `C ${midX} ${r.y + r.height * 0.56} ${r.x + r.width * 0.73} ${bottom} ${r.x + r.width} ${bottom}`,
      'Z',
    ].join(' ');
    return [{ kind: 'path', d }];
  }
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
