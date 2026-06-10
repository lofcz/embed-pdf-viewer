import { createCapabilityToken } from '@embedpdf-x/kernel';
import type { PageObjectNumber } from '@embedpdf-x/kernel';
import type {
  Alignment,
  Anchor,
  Direction,
  Camera,
  PageBox,
  PageMargin,
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
   * Reserved chrome space around EACH PAGE, in SCREEN px (labels below, button
   * rows above, side rails — rendered by the app in the band, e.g. `top: 100%`).
   * Per page, not per item: in a spread every page keeps its own flanks.
   *
   * Naming rule for this settings bag: every setting describes the STAGE itself
   * (the container) — `padding`, `gap`, `layout`, … The rare setting owned by the
   * page carries the `page` prefix (`pageMargin`; `pageWidth` in zoom).
   */
  pageMargin: PageMargin;
  /**
   * Reading direction. RTL: horizontal items advance leftward, spreads bind on the
   * right, grid rows fill right→left, and align.x 'start' means the RIGHT edge
   * (logical, CSS-style). Navigation is index-based and never changes.
   */
  direction: Direction;
  /**
   * Arrival alignment per axis: where attention lands when the target OVERFLOWS
   * (fits → always centered, derived). start/start = LTR reading (top-left),
   * end/start = RTL reading (top-right), center/center = drawings (Drawboard feel).
   */
  align: Alignment;
  /** Zoom intent: a fit-mode (automatic/fit-page/fit-width/fit-all) or a fixed level. */
  zoom: ZoomSpec;
  /** Default behaviour for goToPage/next/prev. */
  scrollBehavior: ScrollBehaviorKind;
}

/** A laid-out page handed to the shell: geometry (PageBox) + durable identity (pon). */
export interface VisiblePage extends PageBox {
  pon: PageObjectNumber;
}

export interface StageState extends StageSettings {
  camera: Camera;
  vp: Size;
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
   * Page space (intrinsic PDF points) → world space. Applies the page's placed
   * origin and contentScale — the transform sizing policies introduce. Compose
   * with toScreen for viewport-space overlays anchored to page content.
   */
  pageToWorld(pon: PageObjectNumber, pt: Point): Point | null;
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
  pageMargin(): PageMargin;
  align(): Alignment;
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
  setPageMargin(pageMargin: PageMargin): void;
  setAlign(align: Alignment): void;
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
