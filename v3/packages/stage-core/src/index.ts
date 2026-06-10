/**
 * @embedpdf-x/stage-core — the pure spatial model.
 *
 * Scene (a layout strategy turns pages into positioned items + a spatial index),
 * Camera ({x,y,zoom}: the world point at the viewport origin + scale), and Anchor
 * (a focal point relative to a page — what survives layout/zoom changes & reloads).
 *
 * Navigation is pure camera math. Bounds/home/margin are three separate functions.
 * No DOM, no framework, fully serializable — this is the v4 Rust core, verbatim.
 */

export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
export interface PageGeom {
  width: number;
  height: number;
}
export interface PageBox {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * World size ÷ intrinsic size for this page (1 for `intrinsic` sizing). The shell
   * multiplies it by the camera zoom to get device-px-per-PDF-point, so render
   * resolution and point↔screen mapping stay correct under `uniform` sizing.
   */
  contentScale: number;
}
export interface SceneItem {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pageIndexes: number[];
  pages: PageBox[];
}
export type Axis = 'x' | 'y' | 'grid';
export interface Scene {
  size: Size;
  items: SceneItem[];
  itemCount: number;
  axis: Axis;
  /**
   * The largest item width & height in the document. Fit-modes resolve against this
   * (not the current page) so the zoom is STABLE across the whole document and no
   * page ever overflows — matching a conventional PDF viewer's "fit width".
   */
  maxItemSize: Size;
  query(rect: Rect): SceneItem[];
  nearestItem(pt: Point): SceneItem;
  itemOfPage(pageIndex: number): number;
}
export interface CameraConstraint {
  bounded: boolean;
  /**
   * Breathing room (screen px) around the content — the ONE spacing concept.
   * Fit-modes inset by it, placement leaves it as gutter, and the clamp lets the
   * camera reveal exactly this much beyond each content edge.
   */
  padding: number;
}
export type ZoomSpec = { mode: ZoomModeValue } | { level: number };
export interface Anchor {
  pageIndex: number;
  fx: number;
  fy: number;
}
export type SpreadMode = 'none' | 'odd' | 'even';
/**
 * Reading direction — a LAYOUT property, not a navigation one. Navigation steps by
 * index (reading order); direction only decides where reading-order puts pages in
 * space: horizontal items advance leftward, spreads bind on the right, grid rows
 * fill right→left. The camera, cursor, fit and clamp never learn about it.
 */
export type Direction = 'ltr' | 'rtl';
/**
 * Page sizing policy (per-item world scale, set in the layout):
 *   'intrinsic' — true PDF sizes; relative proportions preserved.
 *   'uniform'   — every item scaled to the same CROSS-axis size (vertical → equal
 *                 widths, horizontal → equal heights, grid → equal widths), so pages
 *                 sit flush with no left/right gaps. Camera/zoom are untouched.
 */
export type SizingMode = 'intrinsic' | 'uniform';

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 64;
export const ZoomMode = {
  Automatic: 'automatic',
  FitPage: 'fit-page',
  FitWidth: 'fit-width',
  /** Fit the WHOLE scene (every page) in view — the construction overview. */
  FitAll: 'fit-all',
} as const;
export type ZoomModeValue = (typeof ZoomMode)[keyof typeof ZoomMode];

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

// ── Projection ──────────────────────────────────────────────────────────────
export const toScreen = (c: Camera, w: Point): Point => ({
  x: (w.x - c.x) * c.zoom,
  y: (w.y - c.y) * c.zoom,
});
export const toWorld = (c: Camera, s: Point): Point => ({
  x: c.x + s.x / c.zoom,
  y: c.y + s.y / c.zoom,
});
export const cameraWorldRect = (c: Camera, vp: Size): Rect => ({
  x: c.x,
  y: c.y,
  width: vp.width / c.zoom,
  height: vp.height / c.zoom,
});

// ── Camera operations ────────────────────────────────────────────────────────
/** Focal zoom: keep the world point under `screenPt` fixed (no bounce). */
export const zoomAround = (c: Camera, screenPt: Point, factor: number): Camera => {
  const zoom = clamp(c.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  return {
    x: c.x + screenPt.x / c.zoom - screenPt.x / zoom,
    y: c.y + screenPt.y / c.zoom - screenPt.y / zoom,
    zoom,
  };
};
export const panByScreen = (c: Camera, dxScreen: number, dyScreen: number): Camera => ({
  x: c.x - dxScreen / c.zoom,
  y: c.y - dyScreen / c.zoom,
  zoom: c.zoom,
});
export const centerOnWorld = (worldPt: Point, vp: Size, zoom: number): Camera => ({
  zoom,
  x: worldPt.x - vp.width / 2 / zoom,
  y: worldPt.y - vp.height / 2 / zoom,
});

/**
 * Bounds — the one place travel limits live. Clamps the camera into an arbitrary
 * world `Rect` (the whole document in continuous flow, one item in paged flow),
 * with a `padding` gutter the camera may reveal beyond each content edge.
 * Per axis: if the padded content fits the viewport it is CENTERED & locked;
 * otherwise the camera travels freely between the padded edges.
 */
export const clampCamera = (c: Camera, bounds: Rect, vp: Size, k: CameraConstraint): Camera => {
  if (!k.bounded) return c;
  const p = k.padding;
  const axis = (pos: number, origin: number, content: number, view: number): number => {
    if (content * c.zoom <= view - 2 * p) return origin + (content - view / c.zoom) / 2; // fits: centre & lock
    return clamp(pos, origin - p / c.zoom, origin + content - (view - p) / c.zoom);
  };
  return {
    zoom: c.zoom,
    x: axis(c.x, bounds.x, bounds.width, vp.width),
    y: axis(c.y, bounds.y, bounds.height, vp.height),
  };
};

/**
 * Per-axis arrival alignment: where attention lands on an OVERFLOWING axis.
 * On the x-axis the values are LOGICAL (CSS-style): 'start' = where reading begins
 * (left in LTR, RIGHT in RTL), 'end' = where it ends. On the y-axis they are
 * physical (start = top). So the default { x:'start', y:'start' } is automatically
 * correct in both directions — no 'auto' value needed.
 */
export type Align = 'start' | 'center' | 'end';
export interface Alignment {
  x: Align;
  y: Align;
}

/**
 * THE placement algorithm — used for every arrival (goToPage, next/prev, reset).
 * The clamp defines the camera's legal travel range within the subject; alignment
 * just picks a point in it: start = min, center = midpoint, end = max — with x
 * resolved logically against the reading direction. On an axis where the subject
 * FITS, min = mid = max (the locked center), so alignment automatically becomes
 * irrelevant — "centered when it fits" stays derived, and alignment only resolves
 * the freedom that overflow creates.
 */
export function placeCamera(
  subject: Rect,
  vp: Size,
  zoom: number,
  padding = 0,
  align: Alignment = { x: 'start', y: 'start' },
  direction: Direction = 'ltr',
): Camera {
  const k: CameraConstraint = { bounded: true, padding };
  const lo = clampCamera({ x: -Infinity, y: -Infinity, zoom }, subject, vp, k);
  const hi = clampCamera({ x: Infinity, y: Infinity, zoom }, subject, vp, k);
  const pick = (a: Align, min: number, max: number): number =>
    a === 'start' ? min : a === 'end' ? max : (min + max) / 2;
  // logical x: in RTL, reading starts at the right edge of the travel range
  const x =
    direction === 'rtl'
      ? pick(align.x === 'start' ? 'end' : align.x === 'end' ? 'start' : 'center', lo.x, hi.x)
      : pick(align.x, lo.x, hi.x);
  return { zoom, x, y: pick(align.y, lo.y, hi.y) };
}

// ── Zoom intent — resolved against a fit-box chosen by the caller: the document's
//    max item (continuous), the current item (paged), or the whole scene (fit-all). ─
export function resolveZoom(spec: ZoomSpec, box: Size, vp: Size, padding = 0): number {
  if ('level' in spec) return clamp(spec.level, ZOOM_MIN, ZOOM_MAX);
  const fitW = Math.max(1, vp.width - 2 * padding) / box.width;
  const fitH = Math.max(1, vp.height - 2 * padding) / box.height;
  switch (spec.mode) {
    case ZoomMode.FitWidth:
      return clamp(fitW, ZOOM_MIN, ZOOM_MAX);
    case ZoomMode.FitPage:
    case ZoomMode.FitAll: // same fit math; the caller passes the whole-scene box
      return clamp(Math.min(fitW, fitH), ZOOM_MIN, ZOOM_MAX);
    case ZoomMode.Automatic:
    default:
      // fit width, but never upscale past 100% (Adobe's "Automatic"). Height-
      // independent: a portrait page fills the width and you scroll within it.
      return clamp(Math.min(fitW, 1), ZOOM_MIN, ZOOM_MAX);
  }
}

// ── Anchor — a PAGE-RELATIVE point, the durable "what am I looking at". The world
//    point under a screen position is meaningless across a re-layout (pages move);
//    the page-point survives. Generalized to ANY point; the classic viewport-center
//    anchor is the special case. ────────────────────────────────────────────────
/** The anchor at an arbitrary world point: its nearest page + the point, page-relative. */
export function anchorAtPoint(scene: Scene, worldPt: Point): Anchor {
  const item = scene.nearestItem(worldPt);
  let page = item.pages[0];
  let best = Infinity;
  for (const p of item.pages) {
    const d = Math.abs(p.x + p.width / 2 - worldPt.x);
    if (d < best) {
      best = d;
      page = p;
    }
  }
  return {
    pageIndex: page.pageIndex,
    fx: (worldPt.x - page.x) / page.width,
    fy: (worldPt.y - page.y) / page.height,
  };
}

/** The camera that puts the anchor's world point at a given SCREEN point. */
export function cameraForAnchorAtScreen(
  anchor: Anchor,
  scene: Scene,
  screenPt: Point,
  zoom: number,
): Camera {
  const item = scene.items[scene.itemOfPage(anchor.pageIndex)];
  let page = item.pages[0];
  for (const p of item.pages) if (p.pageIndex === anchor.pageIndex) page = p;
  const world = { x: page.x + anchor.fx * page.width, y: page.y + anchor.fy * page.height };
  return { zoom, x: world.x - screenPt.x / zoom, y: world.y - screenPt.y / zoom };
}

export function anchorFromCamera(cam: Camera, scene: Scene, vp: Size): Anchor {
  return anchorAtPoint(scene, toWorld(cam, { x: vp.width / 2, y: vp.height / 2 }));
}
export function cameraFromAnchor(anchor: Anchor, scene: Scene, vp: Size, zoom: number): Camera {
  return cameraForAnchorAtScreen(anchor, scene, { x: vp.width / 2, y: vp.height / 2 }, zoom);
}

// ── Spatial-index helpers ──────────────────────────────────────────────────────
function lowerBound(arr: number[], t: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function upperBound(arr: number[], t: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
const OVERSCAN = 2;

interface LocalBox {
  pageIndex: number;
  lx: number;
  w: number;
  h: number;
}
function packItem(
  pages: readonly PageGeom[],
  group: number[],
  gap: number,
  direction: Direction = 'ltr',
): { local: LocalBox[]; width: number; height: number } {
  let lx = 0;
  let h = 0;
  const local: LocalBox[] = [];
  for (let j = 0; j < group.length; j++) {
    const pg = pages[group[j]];
    local.push({ pageIndex: group[j], lx, w: pg.width, h: pg.height });
    lx += pg.width + gap;
    if (pg.height > h) h = pg.height;
  }
  const width = Math.max(0, lx - gap);
  if (direction === 'rtl') {
    // reading-first page takes the RIGHTMOST slot (the spread binds on the right)
    for (const b of local) b.lx = width - b.lx - b.w;
  }
  return { local, width, height: h };
}
function placePages(item: SceneItem, local: LocalBox[], contentScale: number): PageBox[] {
  return local.map((b) => ({
    pageIndex: b.pageIndex,
    x: item.x + b.lx,
    y: item.y + (item.height - b.h) / 2,
    width: b.w,
    height: b.h,
    contentScale,
  }));
}

/** Per-item world scale: 1 for intrinsic, else the factor that makes the item's
 *  cross dimension equal to `refCross` (uniform sizing). */
const itemScale = (crossIntrinsic: number, refCross: number, sizing: SizingMode): number =>
  sizing === 'uniform' && crossIntrinsic > 0 ? refCross / crossIntrinsic : 1;

/** Scale a packed item's local page boxes + bounds by `s`. */
const scaleLocal = (local: LocalBox[], s: number): LocalBox[] =>
  s === 1
    ? local
    : local.map((b) => ({ pageIndex: b.pageIndex, lx: b.lx * s, w: b.w * s, h: b.h * s }));

// ── Layout strategies ─────────────────────────────────────────────────────────
export interface LinearOptions {
  gap?: number;
  axis?: 'x' | 'y';
  align?: 'center' | 'start';
  sizing?: SizingMode;
  direction?: Direction;
}
export function linearLayout(
  pages: readonly PageGeom[],
  grouping: number[][],
  opts: LinearOptions = {},
): Scene {
  const gap = opts.gap ?? 16;
  const vertical = (opts.axis ?? 'y') === 'y';
  const align = opts.align ?? 'center';
  const sizing = opts.sizing ?? 'intrinsic';
  const direction = opts.direction ?? 'ltr';
  // RTL mirrors the main axis only when it's horizontal; vertical scroll is
  // direction-agnostic (RTL books still scroll down) — only spreads swap.
  const mirrored = !vertical && direction === 'rtl';

  // Pass 1: pack every item at intrinsic size; the cross axis (width when vertical)
  // gives the reference for `uniform` sizing.
  const packs = grouping.map((group) => packItem(pages, group, gap, direction));
  const crossOf = (p: { width: number; height: number }) => (vertical ? p.width : p.height);
  const refCross = packs.reduce((m, p) => Math.max(m, crossOf(p)), 0);

  // Pass 2: scale each item by its sizing factor, lay it along the main axis.
  const items: SceneItem[] = new Array(grouping.length);
  const locals: LocalBox[][] = new Array(grouping.length);
  const scales: number[] = new Array(grouping.length);
  let main = 0;
  let crossMax = 0;
  let maxW = 0;
  let maxH = 0;

  for (let i = 0; i < grouping.length; i++) {
    const s = itemScale(crossOf(packs[i]), refCross, sizing);
    const width = packs[i].width * s;
    const height = packs[i].height * s;
    scales[i] = s;
    locals[i] = scaleLocal(packs[i].local, s);
    const it: SceneItem = {
      index: i,
      x: 0,
      y: 0,
      width,
      height,
      pageIndexes: grouping[i],
      pages: [],
    };
    if (vertical) {
      it.y = main;
      main += height + gap;
    } else {
      it.x = main;
      main += width + gap;
    }
    crossMax = Math.max(crossMax, vertical ? width : height);
    maxW = Math.max(maxW, width);
    maxH = Math.max(maxH, height);
    items[i] = it;
  }

  const sceneMain = Math.max(0, main - gap);
  const size: Size = vertical
    ? { width: crossMax, height: sceneMain }
    : { width: sceneMain, height: crossMax };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (mirrored) it.x = size.width - it.x - it.width; // reading order advances leftward
    if (vertical) it.x = align === 'center' ? (size.width - it.width) / 2 : 0;
    else it.y = align === 'center' ? (size.height - it.height) / 2 : 0;
    it.pages = placePages(it, locals[i], scales[i]);
  }

  // Spatial index in POSITION order (ascending coordinates for binary search).
  // In a mirrored layout position order is reverse index order — `posIdx` maps back.
  const posIdx = (k: number): number => (mirrored ? items.length - 1 - k : k);
  const starts = items.map((_, k) => {
    const it = items[posIdx(k)];
    return vertical ? it.y : it.x;
  });
  const ends = items.map((_, k) => {
    const it = items[posIdx(k)];
    return vertical ? it.y + it.height : it.x + it.width;
  });
  const firstPage = items.map((it) => it.pageIndexes[0]);

  return {
    size,
    items,
    itemCount: items.length,
    axis: vertical ? 'y' : 'x',
    maxItemSize: { width: maxW, height: maxH },
    query(r) {
      const a0 = vertical ? r.y : r.x;
      const a1 = vertical ? r.y + r.height : r.x + r.width;
      const lo = Math.max(0, lowerBound(ends, a0) - OVERSCAN);
      const hi = Math.min(items.length, upperBound(starts, a1) + OVERSCAN);
      const out: SceneItem[] = [];
      for (let k = lo; k < hi; k++) out.push(items[posIdx(k)]);
      return out;
    },
    nearestItem(pt) {
      const k = clamp(upperBound(starts, vertical ? pt.y : pt.x) - 1, 0, items.length - 1);
      return items[posIdx(k)];
    },
    itemOfPage(pi) {
      return clamp(upperBound(firstPage, pi) - 1, 0, items.length - 1);
    },
  };
}

export interface GridOptions {
  gap?: number;
  columns?: number;
  /**
   * WRAPPED mode: instead of declaring `columns`, give the available line width
   * (world units) and the grid derives how many cells fit — the responsive
   * thumbnail-sidebar behavior. Takes precedence over `columns`.
   */
  lineWidth?: number;
  sizing?: SizingMode;
  direction?: Direction;
}
export function gridLayout(
  pages: readonly PageGeom[],
  grouping: number[][],
  opts: GridOptions = {},
): Scene {
  const gap = opts.gap ?? 48;
  const n = grouping.length;
  const sizing = opts.sizing ?? 'intrinsic';
  const direction = opts.direction ?? 'ltr';

  // Pass 1: pack at intrinsic size; the widest item is the `uniform` reference.
  const packs = grouping.map((group) => packItem(pages, group, gap, direction));
  const refW = packs.reduce((m, p) => Math.max(m, p.width), 0);

  // Pass 2: scale each item (uniform → equal width, so columns line up).
  const locals: LocalBox[][] = new Array(n);
  const sizes: Array<{ width: number; height: number }> = new Array(n);
  const scales: number[] = new Array(n);
  let cellW = 1;
  let cellH = 1;
  for (let i = 0; i < n; i++) {
    const s = itemScale(packs[i].width, refW, sizing);
    scales[i] = s;
    locals[i] = scaleLocal(packs[i].local, s);
    sizes[i] = { width: packs[i].width * s, height: packs[i].height * s };
    cellW = Math.max(cellW, sizes[i].width);
    cellH = Math.max(cellH, sizes[i].height);
  }

  // Column count — declared, or DERIVED from the available line width (wrapped):
  // how many cells fit the line. Computed here because it needs cellW. Clamped to
  // the item count so a short document doesn't occupy (or mirror across) a wider
  // line than it fills.
  const wanted =
    opts.lineWidth !== undefined
      ? Math.floor((opts.lineWidth + gap) / (cellW + gap))
      : (opts.columns ?? Math.ceil(Math.sqrt(n)));
  const columns = Math.max(1, Math.min(wanted, Math.max(1, n)));
  // RTL fills each row right→left (like RTL text wrap); rows stay top→bottom.
  const colAt = (col: number): number => (direction === 'rtl' ? columns - 1 - col : col);

  const stepX = cellW + gap;
  const stepY = cellH + gap;
  const items: SceneItem[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const col = colAt(i % columns);
    const row = Math.floor(i / columns);
    const it: SceneItem = {
      index: i,
      x: col * stepX + (cellW - sizes[i].width) / 2,
      y: row * stepY + (cellH - sizes[i].height) / 2,
      width: sizes[i].width,
      height: sizes[i].height,
      pageIndexes: grouping[i],
      pages: [],
    };
    it.pages = placePages(it, locals[i], scales[i]);
    items[i] = it;
  }

  const rows = Math.max(1, Math.ceil(n / columns));
  const size: Size = { width: columns * stepX - gap, height: rows * stepY - gap };
  const firstPage = items.map((it) => it.pageIndexes[0]);

  return {
    size,
    items,
    itemCount: n,
    axis: 'grid',
    maxItemSize: { width: cellW, height: cellH },
    query(r) {
      const c0 = Math.max(0, Math.floor(r.x / stepX));
      const c1 = Math.min(columns - 1, Math.floor((r.x + r.width) / stepX));
      const r0 = Math.max(0, Math.floor(r.y / stepY));
      const r1 = Math.min(rows - 1, Math.floor((r.y + r.height) / stepY));
      const out: SceneItem[] = [];
      for (let row = r0; row <= r1; row++)
        for (let col = c0; col <= c1; col++) {
          // colAt is its own inverse: spatial column → reading-order column
          const idx = row * columns + colAt(col);
          if (idx < n) out.push(items[idx]);
        }
      return out;
    },
    nearestItem(pt) {
      const col = clamp(Math.floor(pt.x / stepX), 0, columns - 1);
      const row = clamp(Math.floor(pt.y / stepY), 0, rows - 1);
      return items[clamp(row * columns + colAt(col), 0, n - 1)];
    },
    itemOfPage(pi) {
      return clamp(upperBound(firstPage, pi) - 1, 0, n - 1);
    },
  };
}

/** Spread grouping — a pure input to layout (all `plugin-spread` needs to be). */
export function groupPages(pageCount: number, mode: SpreadMode = 'none'): number[][] {
  const out: number[][] = [];
  if (mode === 'none') {
    for (let i = 0; i < pageCount; i++) out.push([i]);
    return out;
  }
  let i = 0;
  if (mode === 'even' && pageCount > 0) out.push([i++]);
  for (; i < pageCount; i += 2) out.push(i + 1 < pageCount ? [i, i + 1] : [i]);
  return out;
}
