import { createCapabilityToken } from '@embedpdf-x/kernel';
import type { PageObjectNumber } from '@embedpdf-x/kernel';
import type {
  Anchor,
  Camera,
  Overscroll,
  PageBox,
  Point,
  Size,
  SpreadMode,
  ZoomModeValue,
  ZoomSpec,
} from '@embedpdf-x/stage-core';

export type LayoutKind = 'vertical' | 'horizontal' | 'grid';
export type HomeKind = 'start' | 'center';
/** Navigation (goToPage) either tweens the camera or jumps instantly. */
export type ScrollBehaviorKind = 'smooth' | 'instant';

/**
 * The Stage's orthogonal, independently-settable primitives. Every field can be set
 * on its own (setLayout, setBounded, …) or several at once via `update()`. A
 * "preset" is just a `Partial<StageSettings>` the app keeps and applies — no preset
 * machinery lives here.
 */
export interface StageSettings {
  layout: LayoutKind;
  spread: SpreadMode;
  /** Clamp the camera to the content? Off = free infinite pan (plans / CAD). */
  bounded: boolean;
  /** How far past the edge the viewport centre may travel (px, or 'center'). */
  overscroll: Overscroll;
  /** Initial/reset placement: page at the start of the axis, or centred. */
  home: HomeKind;
  /** Start-margin (px) used by home placement. */
  margin: number;
  /** Zoom intent: a fit-mode or a fixed level. */
  zoom: ZoomSpec;
  /** Default behaviour for goToPage. */
  scrollBehavior: ScrollBehaviorKind;
}

/** A laid-out page handed to the shell: geometry (PageBox) + durable identity (pon). */
export interface VisiblePage extends PageBox {
  pon: PageObjectNumber;
}

export interface StageState extends StageSettings {
  camera: Camera;
  vp: Size;
}

export type StageAction =
  | { type: 'CAMERA'; camera: Camera }
  | { type: 'VP'; vp: Size }
  | { type: 'PATCH'; patch: Partial<StageSettings> };

/** Durable, serializable view state — the unit of session persistence. */
export interface StageViewState extends StageSettings {
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

/** The Stage's public contract: selectors (reads) + intents (the only writers). */
export interface StageCapability {
  // ── selectors ──
  camera(): Camera;
  viewport(): Size;
  pageCount(): number;
  visiblePages(): VisiblePage[];
  /** Current page's *display index* (for "page N of M"). */
  currentPage(): number;
  /** The laid-out box for a page by its durable pon. */
  pageRect(pon: PageObjectNumber): VisiblePage | null;
  toScreen(world: Point): Point;
  toWorld(screen: Point): Point;
  layout(): LayoutKind;
  spread(): SpreadMode;
  bounded(): boolean;
  overscroll(): Overscroll;
  home(): HomeKind;
  margin(): number;
  scrollBehavior(): ScrollBehaviorKind;
  zoomLevel(): number;
  /** The active zoom intent: a fit-mode, or 'custom' for a fixed level. */
  zoomMode(): ZoomModeValue | 'custom';
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
  /** Fit width but never upscale past 100% (Adobe's "Automatic"). */
  automatic(): void;
  goToPage(pageIndex: number, opts?: { behavior?: ScrollBehaviorKind }): void;
  /** Set any subset of settings at once — ONE anchor-preserving update. The way to
   *  apply a customer preset: `update(myPreset)`. */
  update(patch: Partial<StageSettings>): void;
  setLayout(layout: LayoutKind): void;
  setSpread(spread: SpreadMode): void;
  setBounded(bounded: boolean): void;
  setOverscroll(overscroll: Overscroll): void;
  setHome(home: HomeKind): void;
  setMargin(margin: number): void;
  setScrollBehavior(behavior: ScrollBehaviorKind): void;
  applyViewState(view: StageViewState): void;
  /** Offer a candidate initial view; the highest-priority non-null wins at placement. */
  provideInitialView(priority: number, provider: () => StageViewState | null): void;
  /** Resolve the registered providers once (else reset). Called when the viewport is ready. */
  placeInitial(): void;
  /** Re-place the first page at home (the current `home`/`margin`/`zoom`). */
  resetView(): void;
}

export interface StageConfig extends Partial<StageSettings> {
  /** Override the host timing seam (tests/SSR). Defaults to browser rAF. */
  scheduler?: Scheduler;
}

export const StageToken = createCapabilityToken<StageCapability>('stage');
