import { createCapabilityToken } from '@embedpdf/kernel';
import type {
  Anchor,
  Camera,
  PageBox,
  Point,
  Size,
  SpreadMode,
  ZoomSpec,
} from '@embedpdf/stage-core';

export type LayoutKind = 'vertical' | 'horizontal' | 'grid';
export type FramingKind = 'document' | 'canvas';

export interface StageState {
  camera: Camera;
  vp: Size;
  layout: LayoutKind;
  spread: SpreadMode;
  framing: FramingKind;
  zoomSpec: ZoomSpec;
}

export type StageAction =
  | { type: 'CAMERA'; camera: Camera }
  | { type: 'VP'; vp: Size }
  | { type: 'LAYOUT'; layout: LayoutKind }
  | { type: 'SPREAD'; spread: SpreadMode }
  | { type: 'FRAMING'; framing: FramingKind }
  | { type: 'ZOOMSPEC'; zoomSpec: ZoomSpec };

/** Durable, serializable view state — the unit of session persistence. */
export interface StageViewState {
  layout: LayoutKind;
  spread: SpreadMode;
  framing: FramingKind;
  zoomSpec: ZoomSpec;
  anchor: Anchor;
}

/** The Stage's public contract: pure selectors + write-only intents. */
export interface StageCapability {
  // ── selectors ──
  camera(): Camera;
  viewport(): Size;
  pageCount(): number;
  visiblePages(): PageBox[];
  currentPage(): number;
  pageRect(pageIndex: number): PageBox | null;
  toScreen(world: Point): Point;
  toWorld(screen: Point): Point;
  layout(): LayoutKind;
  framing(): FramingKind;
  spread(): SpreadMode;
  zoomLevel(): number;
  viewState(): StageViewState;
  // ── intents ──
  setViewport(vp: Size): void;
  setCamera(c: Camera): void;
  panBy(dxScreen: number, dyScreen: number): void;
  zoomAround(screenPt: Point, factor: number): void;
  zoomTo(spec: ZoomSpec): void;
  zoomIn(): void;
  zoomOut(): void;
  fitWidth(): void;
  fitPage(): void;
  goToPage(pageIndex: number): void;
  setLayout(layout: LayoutKind): void;
  setSpread(spread: SpreadMode): void;
  setFraming(framing: FramingKind): void;
  applyViewState(view: StageViewState): void;
  /** Offer a candidate initial view; the highest-priority non-null wins at placement. */
  provideInitialView(priority: number, provider: () => StageViewState | null): void;
  /** Resolve the registered providers once (else home). Called when the viewport is ready. */
  placeInitial(): void;
  home(): void;
}

export interface StageConfig {
  layout?: LayoutKind;
  framing?: FramingKind;
}

export const StageToken = createCapabilityToken<StageCapability>('stage');
