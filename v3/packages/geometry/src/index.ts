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
