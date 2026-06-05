// @ts-check
/**
 * stage-core — the pure, framework-free, DOM-free spatial model for a PDF viewer.
 *
 * Three concepts, nothing else:
 *   Scene   — pages arranged in UNSCALED world space (a layout strategy builds it).
 *             Each item (a page or a spread) carries its individual page boxes.
 *   Camera  — { x, y, zoom }: the world point at the viewport's top-left, plus scale.
 *   Anchor  — { pageIndex, fx, fy }: a focal point expressed RELATIVE to a page.
 *             This is what survives layout / zoom / spread changes and reloads.
 *
 * Navigation (scroll, zoom, pan, go-to-page, fit) is pure camera math. Zoom is an
 * INTENT (a mode or a fixed level) resolved against the current page, so it stays
 * stable across layouts. Centering & bounds live in one function (clampCamera).
 *
 * Pure + synchronous + serializable => the natural Crux/Rust core for v4.
 */

/** @typedef {{ width: number, height: number }} Size */
/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */
/** @typedef {{ x: number, y: number, zoom: number }} Camera */
/** @typedef {{ width: number, height: number }} PageGeom */
/** @typedef {{ pageIndex: number, x: number, y: number, width: number, height: number }} PageBox */
/** @typedef {{ index: number, x: number, y: number, width: number, height: number, pageIndexes: number[], pages: PageBox[] }} SceneItem */
/** @typedef {{ size: Size, items: SceneItem[], itemCount: number, axis: 'x'|'y'|'grid', query: (r: Rect) => SceneItem[], nearestItem: (p: Point) => SceneItem, itemOfPage: (pageIndex: number) => number }} Scene */
/** @typedef {{ bounded: boolean, overscroll: { x: number|'center', y: number|'center' } }} CameraConstraint */
/** @typedef {{ mode: 'automatic'|'fit-page'|'fit-width' } | { level: number }} ZoomSpec */
/** @typedef {{ pageIndex: number, fx: number, fy: number }} Anchor */

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 64;
export const ZoomMode = Object.freeze({
  Automatic: 'automatic', // fit width, but never upscale past 100%
  FitPage: 'fit-page', // whole page visible
  FitWidth: 'fit-width', // page width fills the viewport
});

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// ───────────────────────────────────────────────────────────────────────────
// Projection — the ONLY mapping between world and screen.
// ───────────────────────────────────────────────────────────────────────────

/** @param {Camera} c @param {Point} w @returns {Point} */
export const toScreen = (c, w) => ({ x: (w.x - c.x) * c.zoom, y: (w.y - c.y) * c.zoom });
/** @param {Camera} c @param {Point} s @returns {Point} */
export const toWorld = (c, s) => ({ x: c.x + s.x / c.zoom, y: c.y + s.y / c.zoom });
/** The world rect the camera currently sees. @param {Camera} c @param {Size} vp @returns {Rect} */
export const cameraWorldRect = (c, vp) => ({
  x: c.x,
  y: c.y,
  width: vp.width / c.zoom,
  height: vp.height / c.zoom,
});

// ───────────────────────────────────────────────────────────────────────────
// Camera operations — every interaction reduces to one of these. All pure.
// ───────────────────────────────────────────────────────────────────────────

/** Focal-point zoom: keep the world point under `screenPt` fixed. @param {Camera} c @param {Point} screenPt @param {number} factor @returns {Camera} */
export const zoomAround = (c, screenPt, factor) => {
  const zoom = clamp(c.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  return {
    x: c.x + screenPt.x / c.zoom - screenPt.x / zoom,
    y: c.y + screenPt.y / c.zoom - screenPt.y / zoom,
    zoom,
  };
};

/** Pan by a screen-space delta. @param {Camera} c @param {number} dxScreen @param {number} dyScreen @returns {Camera} */
export const panByScreen = (c, dxScreen, dyScreen) => ({
  x: c.x - dxScreen / c.zoom,
  y: c.y - dyScreen / c.zoom,
  zoom: c.zoom,
});

/** Camera that places a world point at the viewport centre. @param {Point} worldPt @param {Size} vp @param {number} zoom @returns {Camera} */
export const centerOnWorld = (worldPt, vp, zoom) => ({
  zoom,
  x: worldPt.x - vp.width / 2 / zoom,
  y: worldPt.y - vp.height / 2 / zoom,
});

/**
 * Bounds — the ONE place travel limits live. Defined by where the viewport CENTRE
 * may go, via per-axis `overscroll` (screen px, or 'center' = half the viewport):
 *   0          edges align to viewport edges (classic scroll)
 *   'center'   viewport centre can reach the content edges (centre any page; zoom to top)
 * If the whole document fits an axis, it is centred and locked on that axis.
 * @param {Camera} c @param {Size} scene @param {Size} vp @param {CameraConstraint} k @returns {Camera}
 */
export const clampCamera = (c, scene, vp, k) => {
  if (!k.bounded) return c;
  const axis = (pos, content, view, os) => {
    if (content * c.zoom <= view) return (content - view / c.zoom) / 2; // fits: centre & lock
    const o = os === 'center' ? view / 2 : os || 0;
    return clamp(pos, -o / c.zoom, content - (view - o) / c.zoom);
  };
  return {
    zoom: c.zoom,
    x: axis(c.x, scene.width, vp.width, k.overscroll?.x ?? 0),
    y: axis(c.y, scene.height, vp.height, k.overscroll?.y ?? 0),
  };
};

/**
 * Initial / reset placement — separate from bounds.
 *   'start'  first page at the START of the scroll axis (top for vertical, left for
 *            horizontal) with a screen-px margin. Adobe-like document feel.
 *   'center' first page's centre at the viewport centre. Canvas / construction feel.
 * @param {Scene} scene @param {Size} vp @param {number} zoom
 * @param {{ home: 'start'|'center', margin?: number }} opts @returns {Camera}
 */
export function homeCamera(scene, vp, zoom, opts) {
  const item = scene.items[0];
  const cam = centerOnWorld({ x: item.x + item.width / 2, y: item.y + item.height / 2 }, vp, zoom);
  if (opts.home === 'start') {
    const m = (opts.margin ?? 0) / zoom;
    if (scene.axis === 'x')
      cam.x = item.x - m; // left + margin
    else cam.y = item.y - m; // top + margin (vertical / grid)
  }
  return cam;
}

// ───────────────────────────────────────────────────────────────────────────
// Zoom intent — resolved against the CURRENT page (not the scene), so switching
// vertical<->horizontal<->grid never changes the zoom.
// ───────────────────────────────────────────────────────────────────────────

/** @param {ZoomSpec} spec @param {SceneItem} item @param {Size} vp @param {number} [gap] @returns {number} */
export function resolveZoom(spec, item, vp, gap = 0) {
  if (spec && 'level' in spec) return clamp(spec.level, ZOOM_MIN, ZOOM_MAX);
  const fitW = Math.max(1, vp.width - 2 * gap) / item.width;
  const fitH = Math.max(1, vp.height - 2 * gap) / item.height;
  switch (spec && spec.mode) {
    case ZoomMode.FitWidth:
      return clamp(fitW, ZOOM_MIN, ZOOM_MAX);
    case ZoomMode.FitPage:
      return clamp(Math.min(fitW, fitH), ZOOM_MIN, ZOOM_MAX);
    case ZoomMode.Automatic:
    default:
      return clamp(Math.min(fitW, 1), ZOOM_MIN, ZOOM_MAX);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Anchor — the durable "what am I looking at". Capture before any change,
// restore after. Same mechanism powers layout switches AND session restore.
// ───────────────────────────────────────────────────────────────────────────

/** @param {Camera} cam @param {Scene} scene @param {Size} vp @returns {Anchor} */
export function anchorFromCamera(cam, scene, vp) {
  const c = toWorld(cam, { x: vp.width / 2, y: vp.height / 2 });
  const item = scene.nearestItem(c);
  let page = item.pages[0];
  let best = Infinity;
  for (const p of item.pages) {
    const d = Math.abs(p.x + p.width / 2 - c.x); // pages sit side by side on x
    if (d < best) {
      best = d;
      page = p;
    }
  }
  // not clamped: keeps the round-trip exact (so reload restores precisely)
  return {
    pageIndex: page.pageIndex,
    fx: (c.x - page.x) / page.width,
    fy: (c.y - page.y) / page.height,
  };
}

/** @param {Anchor} anchor @param {Scene} scene @param {Size} vp @param {number} zoom @returns {Camera} */
export function cameraFromAnchor(anchor, scene, vp, zoom) {
  const item = scene.items[scene.itemOfPage(anchor.pageIndex)];
  let page = item.pages[0];
  for (const p of item.pages) if (p.pageIndex === anchor.pageIndex) page = p;
  const worldPt = { x: page.x + anchor.fx * page.width, y: page.y + anchor.fy * page.height };
  return centerOnWorld(worldPt, vp, zoom);
}

// ───────────────────────────────────────────────────────────────────────────
// Layout strategies — pure: (pages, grouping, opts) -> Scene. Each carries its
// own spatial index (query) so virtualization is O(log n + visible), not a scan.
// ───────────────────────────────────────────────────────────────────────────

function lowerBound(arr, t) {
  let lo = 0,
    hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function upperBound(arr, t) {
  let lo = 0,
    hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
const OVERSCAN = 2;

// Lay a single item's pages side by side on local x, with `gap` between them
// (a spread = left/right pages). Returns the local boxes + bounding size.
function packItem(pages, group, gap) {
  let lx = 0;
  let h = 0;
  const local = [];
  for (let j = 0; j < group.length; j++) {
    const pg = pages[group[j]];
    local.push({ pageIndex: group[j], lx, w: pg.width, h: pg.height });
    lx += pg.width + gap;
    if (pg.height > h) h = pg.height;
  }
  return { local, width: Math.max(0, lx - gap), height: h };
}

// Resolve each item's local page boxes into absolute world boxes, centring pages
// vertically within the item (so a short page next to a tall one looks right).
function placePages(item, local) {
  return local.map((b) => ({
    pageIndex: b.pageIndex,
    x: item.x + b.lx,
    y: item.y + (item.height - b.h) / 2,
    width: b.w,
    height: b.h,
  }));
}

/**
 * Linear stack (vertical or horizontal). Items advance along the scroll axis;
 * pages within an item (a spread) sit side by side with the SAME gap.
 * @param {PageGeom[]} pages @param {number[][]} grouping
 * @param {{ gap?: number, axis?: 'x'|'y', align?: 'center'|'start' }} [opts]
 * @returns {Scene}
 */
export function linearLayout(pages, grouping, opts = {}) {
  const gap = opts.gap ?? 16;
  const vertical = (opts.axis ?? 'y') === 'y';
  const align = opts.align ?? 'center';

  /** @type {SceneItem[]} */
  const items = new Array(grouping.length);
  const locals = new Array(grouping.length);
  let main = 0;
  let crossMax = 0;

  for (let i = 0; i < grouping.length; i++) {
    const packed = packItem(pages, grouping[i], gap);
    locals[i] = packed.local;
    const it = /** @type {SceneItem} */ ({
      index: i,
      x: 0,
      y: 0,
      width: packed.width,
      height: packed.height,
      pageIndexes: grouping[i],
      pages: [],
    });
    if (vertical) {
      it.y = main;
      main += packed.height + gap;
    } else {
      it.x = main;
      main += packed.width + gap;
    }
    crossMax = Math.max(crossMax, vertical ? packed.width : packed.height);
    items[i] = it;
  }

  const sceneMain = Math.max(0, main - gap);
  const size = vertical
    ? { width: crossMax, height: sceneMain }
    : { width: sceneMain, height: crossMax };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (vertical) it.x = align === 'center' ? (size.width - it.width) / 2 : 0;
    else it.y = align === 'center' ? (size.height - it.height) / 2 : 0;
    it.pages = placePages(it, locals[i]);
  }

  const starts = items.map((it) => (vertical ? it.y : it.x));
  const ends = items.map((it) => (vertical ? it.y + it.height : it.x + it.width));
  const firstPage = items.map((it) => it.pageIndexes[0]);

  return {
    size,
    items,
    itemCount: items.length,
    axis: vertical ? 'y' : 'x',
    query(r) {
      const a0 = vertical ? r.y : r.x;
      const a1 = vertical ? r.y + r.height : r.x + r.width;
      const lo = Math.max(0, lowerBound(ends, a0) - OVERSCAN);
      const hi = Math.min(items.length, upperBound(starts, a1) + OVERSCAN);
      return items.slice(lo, hi);
    },
    nearestItem(pt) {
      const i = clamp(upperBound(starts, vertical ? pt.y : pt.x) - 1, 0, items.length - 1);
      return items[i];
    },
    itemOfPage(pi) {
      return clamp(upperBound(firstPage, pi) - 1, 0, items.length - 1);
    },
  };
}

/**
 * Grid / free canvas. Uniform cells keep the index trivial; pages within a cell
 * sit side by side (spreads). Use with constraint.bounded=false for infinite canvas.
 * @param {PageGeom[]} pages @param {number[][]} grouping
 * @param {{ gap?: number, columns?: number }} [opts]
 * @returns {Scene}
 */
export function gridLayout(pages, grouping, opts = {}) {
  const gap = opts.gap ?? 48;
  const n = grouping.length;
  const columns = opts.columns ?? Math.max(1, Math.ceil(Math.sqrt(n)));

  const locals = new Array(n);
  const sizes = new Array(n);
  let cellW = 1;
  let cellH = 1;
  for (let i = 0; i < n; i++) {
    const packed = packItem(pages, grouping[i], gap);
    locals[i] = packed.local;
    sizes[i] = packed;
    cellW = Math.max(cellW, packed.width);
    cellH = Math.max(cellH, packed.height);
  }

  const stepX = cellW + gap;
  const stepY = cellH + gap;
  /** @type {SceneItem[]} */
  const items = new Array(n);
  for (let i = 0; i < n; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const it = /** @type {SceneItem} */ ({
      index: i,
      x: col * stepX + (cellW - sizes[i].width) / 2,
      y: row * stepY + (cellH - sizes[i].height) / 2,
      width: sizes[i].width,
      height: sizes[i].height,
      pageIndexes: grouping[i],
      pages: [],
    });
    it.pages = placePages(it, locals[i]);
    items[i] = it;
  }

  const rows = Math.ceil(n / columns);
  const size = { width: columns * stepX - gap, height: rows * stepY - gap };
  const firstPage = items.map((it) => it.pageIndexes[0]);

  return {
    size,
    items,
    itemCount: n,
    axis: 'grid',
    query(r) {
      const c0 = Math.max(0, Math.floor(r.x / stepX));
      const c1 = Math.min(columns - 1, Math.floor((r.x + r.width) / stepX));
      const r0 = Math.max(0, Math.floor(r.y / stepY));
      const r1 = Math.min(rows - 1, Math.floor((r.y + r.height) / stepY));
      const out = [];
      for (let row = r0; row <= r1; row++)
        for (let col = c0; col <= c1; col++) {
          const idx = row * columns + col;
          if (idx < n) out.push(items[idx]);
        }
      return out;
    },
    nearestItem(pt) {
      const col = clamp(Math.floor(pt.x / stepX), 0, columns - 1);
      const row = clamp(Math.floor(pt.y / stepY), 0, rows - 1);
      return items[clamp(row * columns + col, 0, n - 1)];
    },
    itemOfPage(pi) {
      return clamp(upperBound(firstPage, pi) - 1, 0, n - 1);
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Spread grouping — a pure input to layout (all plugin-spread needs to be).
// ───────────────────────────────────────────────────────────────────────────

/** @param {number} pageCount @param {'none'|'odd'|'even'} mode @returns {number[][]} */
export function groupPages(pageCount, mode = 'none') {
  /** @type {number[][]} */
  const out = [];
  if (mode === 'none') {
    for (let i = 0; i < pageCount; i++) out.push([i]);
    return out;
  }
  let i = 0;
  if (mode === 'even' && pageCount > 0) out.push([i++]); // cover page alone
  for (; i < pageCount; i += 2) out.push(i + 1 < pageCount ? [i, i + 1] : [i]);
  return out;
}
