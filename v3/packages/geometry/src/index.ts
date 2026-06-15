/**
 * @embedpdf-x/geometry — the viewer's pure 2D coordinate primitives.
 *
 * The bottom of the pyramid: stage-core (layout), plugin-stage (`pageToWorld`),
 * and every framework adapter (`toPagePoint` hit-testing) all sit on these.
 * Zero dependencies, DOM-free, serializable — Rust-portable.
 *
 * The page-rotation transforms are the reason this package exists: the same
 * quarter-turn maps content↔box in BOTH directions, and that one rule must not
 * be hand-written (and drift, or be bug-fixed in only one of four adapters).
 */

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
/** Viewer-side rect: top-left origin, y-down (view/page-point convention — NOT the
 *  engine's bottom-left PDF rect). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Quarter-turn display rotation, degrees clockwise. The viewer-side notion of a
 * page's on-screen rotation — the TOTAL = (document /Rotate + any view
 * rotation), resolved by the shell. Structurally identical to the engine's
 * `PageRotation`, so the two interoperate without this package depending on the
 * engine.
 */
export type PageRotation = 0 | 90 | 180 | 270;

/**
 * Reserved chrome real estate around a page, one thickness per side (screen px
 * in the shell; world units in the pure layout). The page content sits inset
 * by these; the bands hold box-space chrome (labels, buttons, rails) that does
 * not rotate. The layout reserves the matching space so nothing overlaps.
 */
export interface PageFrame {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export const NO_FRAME: PageFrame = { top: 0, right: 0, bottom: 0, left: 0 };

/** True for the quarter-turns that swap a page's width and height. */
export function isQuarterTurn(rotation: PageRotation): boolean {
  return rotation === 90 || rotation === 270;
}

/**
 * Snap a view-px value to the device pixel grid: round to a whole device pixel,
 * back to view px. Used for a page's screen POSITION so a CSS-rotated page lands
 * on the grid (no sub-pixel anti-aliased fringe). The shell never hand-rounds.
 */
export function snapToDevice(value: number, dpr: number): number {
  return Math.round(value * dpr) / dpr;
}

/** A page's on-screen footprint: width and height swapped for quarter-turns. */
export function displaySize(content: Size, rotation: PageRotation): Size {
  return isQuarterTurn(rotation)
    ? { width: content.height, height: content.width }
    : { width: content.width, height: content.height };
}

/**
 * Map an offset in a page's UN-rotated content frame (origin at the content
 * top-left) to the offset within its DISPLAY box (origin at the box top-left),
 * applying a clockwise `rotation`. Unit-agnostic — callers pass world units or
 * screen px. `content` is the un-rotated content size in the same unit.
 *
 * The single source of truth for the forward direction: `pageToWorld` (placing
 * a content point into the world box) and the page surface's content-wrapper
 * transform both derive from this.
 */
export function rotateInBox(offset: Point, content: Size, rotation: PageRotation): Point {
  switch (rotation) {
    case 90:
      // content top-left → box top-right; the left edge becomes the top edge
      return { x: content.height - offset.y, y: offset.x };
    case 180:
      return { x: content.width - offset.x, y: content.height - offset.y };
    case 270:
      return { x: offset.y, y: content.width - offset.x };
    default:
      return { x: offset.x, y: offset.y };
  }
}

/**
 * The exact inverse of {@link rotateInBox}: a display-box offset back to the
 * un-rotated content frame. Hit-testing (screen → page point) is built on this.
 */
export function unrotateInBox(offset: Point, content: Size, rotation: PageRotation): Point {
  switch (rotation) {
    case 90:
      return { x: offset.y, y: content.height - offset.x };
    case 180:
      return { x: content.width - offset.x, y: content.height - offset.y };
    case 270:
      return { x: content.width - offset.y, y: offset.x };
    default:
      return { x: offset.x, y: offset.y };
  }
}

/**
 * Screen point → page point (PDF points), inverting a page surface's rotation
 * and scale. The whole of a framework adapter's `toPagePoint` minus the one
 * platform-bound line (`getRect`), so the trig is verified ONCE here rather
 * than re-derived (and mis-derived) per adapter.
 *
 *   - `center` is the surface's center on screen — rotation-invariant, so it is
 *     read from the rotated wrapper's axis-aligned bounding-box center.
 *   - `contentSize` is the UN-rotated content footprint in SCREEN px.
 *   - `scale` is screen px per PDF point (contentScale × zoom).
 */
export function screenToPagePoint(args: {
  screen: Point;
  center: Point;
  contentSize: Size;
  scale: number;
  rotation: PageRotation;
}): Point {
  const { screen, center, contentSize, scale, rotation } = args;
  // The display box is centered at `center`; express the screen point relative
  // to the box's top-left, then invert the rotation (corner-mapping) into the
  // un-rotated content frame, then scale to PDF points.
  const display = displaySize(contentSize, rotation);
  const boxOffset: Point = {
    x: screen.x - center.x + display.width / 2,
    y: screen.y - center.y + display.height / 2,
  };
  const content = unrotateInBox(boxOffset, contentSize, rotation);
  return { x: content.x / scale, y: content.y / scale };
}

/**
 * The engine's `kind:'width'` height rule, replicated EXACTLY so the viewer can
 * predict the rendered bitmap's height up front — the page box is sized to it,
 * so the box matches the bitmap with no reflow and no 1px seam.
 *
 * Mirrors `PageRenderReader.resolveDeviceSize` (engine-services): we render the
 * page UN-rotated (CSS applies the rotation), so there is no width/height swap
 * here — `pageSize` is the page's own points. MUST stay in lockstep with that
 * function; the round-trip test in the render plugin asserts they agree.
 */
export function deviceHeightForWidth(pageSize: Size, deviceWidth: number): number {
  return Math.max(1, Math.round((deviceWidth * pageSize.height) / pageSize.width));
}

/**
 * The single per-page bridge between the viewer's three coordinate spaces:
 *
 *   page space    PDF points (top-left, y-down) — ALL document data lives here
 *   view space    platform logical px (web: CSS px) — layout, DOM, pointer events
 *   device space  physical pixels — the rendered bitmap
 *
 * PAGE-LOCAL by design: it knows this page's own box, NOT where the page sits in
 * the scene. Placement (camera/layout) stays on `VisiblePage.{x,y}` and positions
 * the page container; the transform converts everything INSIDE that container. So
 * it is camera/pan-invariant — it only changes on zoom / rotation / contentScale
 * / dpr, which makes it cheap to memoize.
 *
 * Every plugin and framework adapter consumes THIS — never `x * scale`, never
 * `pageToWorld()∘toScreen()`, never `* dpr`. New plugins (annotations, search,
 * forms) do no coordinate math; new platforms (iOS/Android) inject a different
 * `scale` and reuse all of it.
 */
export interface PageTransform {
  /** Display footprint in VIEW px (device-snapped) — the page container's size.
   *  Width↔height already swapped for quarter-turns. */
  readonly viewWidth: number;
  readonly viewHeight: number;
  /** The UN-rotated content box in VIEW px — the size of the wrapper the bitmap
   *  and content-space overlays live in (before the wrapper's CSS rotation). */
  readonly contentWidth: number;
  readonly contentHeight: number;
  /** Render the (un-rotated) bitmap at EXACTLY this — `viewport: {kind:'width', width: deviceWidth}`.
   *  Integer device px; `deviceHeight` is the engine's exact derived height. */
  readonly deviceWidth: number;
  readonly deviceHeight: number;
  /** Device px per PDF point (uniform). */
  readonly renderScale: number;
  /** PDF point → UN-rotated content view px. For overlays INSIDE the rotated
   *  content wrapper (markers, annotations) — they ride the wrapper's rotation,
   *  so they place in content space and only scale here. */
  pageToContent(p: Point): Point;
  /** PDF point → page-local view px in the DISPLAY box (rotation applied). For
   *  footprint-space layers (outside the wrapper). */
  pageToView(p: Point): Point;
  /** PDF-point rect → its axis-aligned view-px rect (exact for quarter-turns). */
  pageToViewRect(r: Rect): Rect;
  /** Inverse — display-box view px (box-local) → PDF point. Hit-testing. */
  viewToPage(p: Point): Point;
  /** CSS `matrix()` mapping page-point space → this page's display box. Drop it on
   *  a footprint-space layer (`transform`, `transform-origin: 0 0`) and place
   *  children in raw PDF points — rotation + scale handled for free. */
  readonly cssMatrix: string;
}

/**
 * Build a page's transform from its intrinsic size + the platform/view scale.
 * `scale` is VIEW px per PDF point (the shell composes it: `viewUnitsPerPoint ×
 * contentScale × zoom`); `dpr` is device px per view px. Device dimensions snap
 * to the grid (crisp, no rotation fringe) and follow the engine's width rule
 * (box == bitmap, no reflow).
 */
export function pageTransform(input: {
  /** Un-rotated page size in PDF points. */
  pageSize: Size;
  rotation: PageRotation;
  /** View px per PDF point = viewUnitsPerPoint × contentScale × zoom. */
  scale: number;
  /** Device px per view px (web: devicePixelRatio). */
  dpr: number;
}): PageTransform {
  const { pageSize, rotation, scale, dpr } = input;

  // Raster: pin the width (snapped to the device grid), derive the height with
  // the engine's exact rule → uniform scale, integer device px, box == bitmap.
  const deviceWidth = Math.max(1, Math.round(pageSize.width * scale * dpr));
  const deviceHeight = deviceHeightForWidth(pageSize, deviceWidth);
  const renderScale = deviceWidth / pageSize.width;

  // The un-rotated content box in VIEW px, taken from the snapped device dims so
  // every edge lands on a whole device pixel. The effective view scale is derived
  // from it (not the raw `scale`) so `pageToView(pageWidth) === content edge`.
  const content: Size = { width: deviceWidth / dpr, height: deviceHeight / dpr };
  const viewScale = content.width / pageSize.width;

  const footprint = displaySize(content, rotation);

  const pageToContent = (p: Point): Point => ({ x: p.x * viewScale, y: p.y * viewScale });

  const pageToView = (p: Point): Point => rotateInBox(pageToContent(p), content, rotation);

  const viewToPage = (p: Point): Point => {
    const c = unrotateInBox(p, content, rotation);
    return { x: c.x / viewScale, y: c.y / viewScale };
  };

  const pageToViewRect = (r: Rect): Rect => {
    const cs = [
      pageToView({ x: r.x, y: r.y }),
      pageToView({ x: r.x + r.width, y: r.y }),
      pageToView({ x: r.x, y: r.y + r.height }),
      pageToView({ x: r.x + r.width, y: r.y + r.height }),
    ];
    const xs = cs.map((c) => c.x);
    const ys = cs.map((c) => c.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
  };

  // Derive the CSS matrix from `pageToView` itself (it's affine) so the two can
  // never disagree: columns are the images of the page-space basis vectors.
  const o = pageToView({ x: 0, y: 0 });
  const ux = pageToView({ x: 1, y: 0 });
  const uy = pageToView({ x: 0, y: 1 });
  const cssMatrix = `matrix(${ux.x - o.x}, ${ux.y - o.y}, ${uy.x - o.x}, ${uy.y - o.y}, ${o.x}, ${o.y})`;

  return {
    viewWidth: footprint.width,
    viewHeight: footprint.height,
    contentWidth: content.width,
    contentHeight: content.height,
    deviceWidth,
    deviceHeight,
    renderScale,
    pageToContent,
    pageToView,
    pageToViewRect,
    viewToPage,
    cssMatrix,
  };
}
