import { createCapabilityToken } from '@embedpdf-x/kernel';
import type { PageObjectNumber } from '@embedpdf-x/kernel';
import type { PageTransform, Rect } from '@embedpdf-x/geometry';
import type {
  Alignment,
  Anchor,
  Direction,
  Camera,
  PageBox,
  PageFrame,
  Point,
  Size,
  SizingMode,
  SpreadMode,
  ZoomModeValue,
  ZoomSpec,
} from '@embedpdf-x/stage-core';

export type LayoutKind = 'vertical' | 'horizontal' | 'grid';
/** Navigation (goToPage) either tweens the camera or jumps instantly. */
export type ScrollBehaviorKind = 'smooth' | 'instant';
/**
 * Presentation flow:
 *   'continuous' — the whole document is scrollable; the camera roams the full scene.
 *   'paged'      — one item (page or spread) at a time: the scene is a one-item
 *                  slice at the cursor, and next/prev step between items.
 */
export type FlowMode = 'continuous' | 'paged';
/**
 * Grid column policy:
 *   'square' — ≈√n columns (the classic canvas arrangement)
 *   'auto'   — WRAPPED: as many columns as fit the viewport line at the current
 *              zoom (the responsive thumbnail-sidebar behavior; re-wraps on resize)
 *   number   — a fixed column count
 */
export type GridColumns = 'square' | 'auto' | number;

/**
 * Space between items — the value's shape carries the unit (like ZoomSpec):
 *   number     — WORLD units: the gap is part of the canvas and scales with zoom,
 *                so the whole scene zooms as one rigid object (the document feel).
 *   { px: n }  — SCREEN px: UI-stable spacing, the same in every document at every
 *                zoom (the browser-of-items feel: thumbnails, organizers).
 */
export type Gap = number | { px: number };

/**
 * The Stage's orthogonal, independently-settable primitives. Every field can be set
 * on its own (setLayout, setBounded, …) or several at once via `update()`. A
 * "preset" is just a `Partial<StageSettings>` the app keeps and applies — no preset
 * machinery lives here.
 */
export interface StageSettings {
  /** Continuous scroll, or one item at a time. */
  flow: FlowMode;
  layout: LayoutKind;
  spread: SpreadMode;
  /** Page sizing: true PDF sizes, or equalize the cross axis so pages sit flush. */
  sizing: SizingMode;
  /** Grid column policy (grid layout only): 'square', 'auto' (wrapped), or a count. */
  columns: GridColumns;
  /** Clamp the camera to the content? Off = free infinite pan (plans / CAD). */
  bounded: boolean;
  /**
   * Breathing room (screen px) around the content — the one spacing concept.
   * Fit-modes inset by it, arrivals leave it as a gutter, and the clamp lets the
   * camera reveal exactly this much beyond each content edge.
   */
  padding: number;
  /**
   * Space BETWEEN items — and between the halves of a spread. A number is world
   * units (scales with zoom — the canvas feel); `{ px }` is screen px (UI-stable
   * — the thumbnail feel). See {@link Gap}.
   */
  gap: Gap;
  /**
   * Reserved chrome real estate around EACH PAGE, in SCREEN px — one thickness
   * per side. The page content is inset by these; the bands hold box-space
   * chrome (a label below, a button row above, side rails) painted by the app
   * via the adapter's `pageChrome` slot. Per page, not per item: in a spread
   * every page keeps its own flanks. Constant screen px (unaffected by zoom).
   *
   * Naming rule for this settings bag: every setting describes the STAGE itself
   * (the container) — `padding`, `gap`, `layout`, … The rare setting owned by the
   * page carries the `page` prefix (`pageFrame`; `pageWidth` in zoom).
   */
  pageFrame: PageFrame;
  /**
   * Reading direction. RTL: horizontal items advance leftward, spreads bind on the
   * right, grid rows fill right→left, and alignment 'start' on x means the RIGHT
   * edge (logical, CSS-style). Navigation is index-based and never changes.
   */
  direction: Direction;
  /**
   * The two alignment settings are the two branches of the model's one geometric
   * question — "does it fit the viewport?" (per axis, logical x):
   *
   *   fitAlign      — it FITS: where does content REST in the leftover space?
   *                   Enforced continuously (a fitting axis has nowhere else to
   *                   be). center/center = document feel; y:'start' = sidebar
   *                   thumbnails hugging the top.
   *   overflowAlign — it OVERFLOWS: which part do you show on ARRIVAL
   *                   (goToPage/next/prev)? Guides arrivals only — afterwards the
   *                   axis is free to scroll. start/start = LTR reading
   *                   (top-left), center/center = drawings (Drawboard feel).
   */
  fitAlign: Alignment;
  /** See {@link StageSettings.fitAlign} — arrival anchor on overflowing axes. */
  overflowAlign: Alignment;
  /** Zoom intent: a fit-mode (automatic/fit-page/fit-width/fit-all) or a fixed level. */
  zoom: ZoomSpec;
  /** Default behaviour for goToPage/next/prev. */
  scrollBehavior: ScrollBehaviorKind;
  /**
   * View pixels per PDF point — the platform's physical unit factor, folded into
   * the layout so 100% (zoom 1) is physically accurate. Web = 96/72 (1 pt = 1/72",
   * 1 CSS px = 1/96"); a native platform injects its own (iOS pt, Android dp). It
   * scales every page's world size (and thus `contentScale`), so the camera math,
   * `gap`/`padding`/`pageFrame` (world units), and absolute-px zoom modes
   * (`pageWidth`) are all unaffected — only the pages themselves resize.
   */
  viewUnitsPerPoint: number;
}

/**
 * A laid-out page handed to the shell.
 *  - PageBox + `pon`: LAYOUT truth (world coords + identity) — the shell uses
 *    `x/y/width/height` only to POSITION the page container.
 *  - `transform`: PRESENTATION truth — the single bridge between PDF points,
 *    view px, and device px for this page. Plugins do ALL coordinate work
 *    through it (`pageToView` / `viewToPage` / `deviceWidth` / `cssMatrix`),
 *    never by re-deriving `x * scale` / `* dpr`. Page-local, so it's
 *    camera/pan-invariant.
 */
export interface VisiblePage extends PageBox {
  pon: PageObjectNumber;
  /**
   * The page's DISPLAY-box (footprint) top-left in screen px, camera-resolved and
   * snapped to the device grid. The shell positions the page container at this —
   * snapping here (not in the adapter) keeps a CSS-rotated page on the pixel grid
   * for every framework, with no hand-rounding.
   */
  screenX: number;
  screenY: number;
  transform: PageTransform;
}

export interface StageState extends StageSettings {
  camera: Camera;
  vp: Size;
  /**
   * Device pixels per view pixel (web: `window.devicePixelRatio`). Reported by
   * the shell like the viewport; feeds each page's transform so bitmaps render
   * crisp (exact device px) and boxes land on the device grid. Defaults to 1.
   */
  dpr: number;
  /**
   * The current page — transient like `camera` (NOT a setting), valid in BOTH flows.
   * Navigation sets it; in continuous flow scrolling syncs it from the camera; in
   * paged flow panning never moves it (the scene is a one-item slice at this page).
   * Stored as a page index so it survives spread/layout regrouping.
   */
  cursor: number;
}

export type StageAction =
  | { type: 'CAMERA'; camera: Camera }
  | { type: 'VP'; vp: Size }
  | { type: 'DPR'; dpr: number }
  | { type: 'CURSOR'; cursor: number }
  | { type: 'PATCH'; patch: Partial<StageSettings> };

/**
 * A page-relative view memento: "what I'm looking at and how zoomed". The durable
 * currency for per-page view memory (construction worksheets) — capture with
 * `viewpoint()`, restore with `goToPage(i, { viewpoint })`. Survives resizes
 * because the anchor is page-relative and fit-modes re-resolve.
 */
export interface Viewpoint {
  anchor: Anchor;
  zoom: ZoomSpec;
}

/** Durable, serializable view state — the unit of session persistence. */
export interface StageViewState extends StageSettings {
  cursor: number;
  anchor: Anchor;
}

/**
 * Host timing seam. The pure core (stage-core) never touches time; the camera tween
 * lives in this (impure) shell and asks for frames through a Scheduler. The default
 * is the browser's requestAnimationFrame; inject a fake in tests, or an instant one
 * in Node/SSR.
 */
export interface Scheduler {
  /** Run the callback on the next frame; returns a handle for cancellation. */
  raf(callback: (timestampMs: number) => void): number;
  /** Cancel a scheduled callback. */
  caf(handle: number): void;
}

/** Options for navigation intents. */
export interface GoToOptions {
  behavior?: ScrollBehaviorKind;
  /** Restore this exact viewpoint instead of fresh placement (per-page memory). */
  viewpoint?: Viewpoint;
}

/** The Stage's public contract: selectors (reads) + intents (the only writers). */
export interface StageCapability {
  // ── selectors ──
  camera(): Camera;
  viewport(): Size;
  pageCount(): number;
  visiblePages(): VisiblePage[];
  /** The current page (the cursor) — valid in both flows. */
  currentPage(): number;
  /** The display indices of the current item's pages (1 page, or a spread's pages). */
  currentItemPages(): number[];
  /** The full page list with PDF labels — for page thumbnails / worksheet tabs. */
  pages(): Array<{ index: number; pon: PageObjectNumber; label: string | null }>;
  /** The laid-out box for a page by its durable pon. */
  pageRect(pon: PageObjectNumber): VisiblePage | null;
  /**
   * Screen point (this Stage's container px) → the page under it + its content
   * point, or null over a gap. The viewport-level hit-test the interaction hub
   * needs so a single pointer source can drive page-aware features (text
   * selection, annotations) AND cross-page drags.
   */
  pageAt(screen: Point): { pon: PageObjectNumber; point: Point } | null;
  /**
   * Page space (intrinsic PDF points) → world space. Applies the page's placed
   * origin and contentScale — the transform sizing policies introduce. Compose
   * with toScreen for viewport-space overlays anchored to page content.
   */
  pageToWorld(pon: PageObjectNumber, pt: Point): Point | null;
  /**
   * Content rect on a page → this Stage viewport's screen-space AABB. Applies page
   * rotation/contentScale and the current camera. Use for upright viewport overlays
   * that need to frame a selected page region.
   */
  pageRectToScreen(pon: PageObjectNumber, rect: Rect): Rect | null;
  toScreen(world: Point): Point;
  toWorld(screen: Point): Point;
  flow(): FlowMode;
  layout(): LayoutKind;
  spread(): SpreadMode;
  sizing(): SizingMode;
  columns(): GridColumns;
  bounded(): boolean;
  padding(): number;
  gap(): Gap;
  pageFrame(): PageFrame;
  fitAlign(): Alignment;
  overflowAlign(): Alignment;
  direction(): Direction;
  scrollBehavior(): ScrollBehaviorKind;
  zoomLevel(): number;
  /** The active zoom intent: a fit-mode, or 'custom' for a fixed level. */
  zoomMode(): ZoomModeValue | 'custom';
  /** What I'm looking at + zoom intent — capture for per-page view memory. */
  viewpoint(): Viewpoint;
  /** A snapshot of all settings (handy for building/saving a customer preset). */
  settings(): StageSettings;
  viewState(): StageViewState;

  // ── intents ──
  setViewport(vp: Size): void;
  /** Report the device pixel ratio (web: `devicePixelRatio`). The shell calls
   *  this once on mount and whenever it changes (e.g. dragging between monitors)
   *  so page transforms render crisp. */
  setDevicePixelRatio(dpr: number): void;
  setCamera(c: Camera): void;
  panBy(dxScreen: number, dyScreen: number): void;
  zoomAround(screenPt: Point, factor: number): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomTo(spec: ZoomSpec): void;
  fitWidth(): void;
  fitPage(): void;
  /** Fit the whole scene (every page) in view — the construction overview. */
  fitAll(): void;
  /** Fit width but never upscale past 100% (Adobe's "Automatic"). */
  automatic(): void;
  /**
   * Re-resolve the active zoom intent and re-place against the CURRENT scene,
   * preserving the anchored page-point. Call after the page geometry changes
   * underneath the lens — rotate/move/delete — so fit/pixel zoom modes
   * (`fitPage`, `pageWidth`, …) recompute against the new footprint. A no-op
   * before the first placement; for a fixed `{ level }` zoom it just re-anchors.
   * Wired automatically to the document's page-registry revision; exposed for
   * any external geometry change a host wants to react to.
   */
  refit(): void;
  /** Go to a page. Fresh arrival places by the unit rule; pass `viewpoint` to restore. */
  goToPage(pageIndex: number, opts?: GoToOptions): void;
  /**
   * Make a page VISIBLE with minimal movement — zero if it already is. Not
   * navigation: the cursor is untouched and nothing is re-placed (scrollIntoView
   * semantics; the verb behind follower UIs like thumbnail sidebars, search hits,
   * outline clicks). In paged flow the page isn't in the scene, so reveal
   * delegates to navigation.
   */
  reveal(pageIndex: number, opts?: { behavior?: ScrollBehaviorKind }): void;
  /** Step forward by the navigation unit (the item if it fits the viewport, else the page). */
  next(opts?: GoToOptions): void;
  /** Step backward by the navigation unit. */
  prev(opts?: GoToOptions): void;
  /** Set any subset of settings at once — ONE anchor-preserving update. The way to
   *  apply a customer preset: `update(myPreset)`. */
  update(patch: Partial<StageSettings>): void;
  setFlow(flow: FlowMode): void;
  setLayout(layout: LayoutKind): void;
  setSpread(spread: SpreadMode): void;
  setSizing(sizing: SizingMode): void;
  setColumns(columns: GridColumns): void;
  setBounded(bounded: boolean): void;
  setPadding(padding: number): void;
  setGap(gap: Gap): void;
  setPageFrame(pageFrame: PageFrame): void;
  setFitAlign(fitAlign: Alignment): void;
  setOverflowAlign(overflowAlign: Alignment): void;
  setDirection(direction: Direction): void;
  setScrollBehavior(behavior: ScrollBehaviorKind): void;
  applyViewState(view: StageViewState): void;
  /** Offer a candidate initial view; the highest-priority non-null wins at placement. */
  provideInitialView(priority: number, provider: () => StageViewState | null): void;
  /** Resolve the registered providers once (else reset). Called when the viewport is ready. */
  placeInitial(): void;
  /** Back to the start: page 0, placed by the unit rule at the current zoom intent. */
  resetView(): void;
}

export interface StageConfig extends Partial<StageSettings> {
  /** Override the host timing seam (tests/SSR). Defaults to browser rAF. */
  scheduler?: Scheduler;
}

export const StageToken = createCapabilityToken<StageCapability>('stage');
