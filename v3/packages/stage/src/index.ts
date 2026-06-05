/**
 * @embedpdf/stage — the coordinate core, as a kernel plugin.
 *
 * In v2 these were five fighting plugins (viewport, scroll, zoom, pan, spread).
 * Here they are one: a single Camera + Scene + framing, with a typed capability of
 * intents (goToPage, zoomTo, panBy, setLayout…) and selectors (camera, pageRect,
 * visiblePages…). The DOM lives in the framework adapter, never here.
 */
import { createCapabilityToken, definePlugin } from '@embedpdf/kernel';
import type { PluginContext } from '@embedpdf/kernel';
import * as S from '@embedpdf/stage-core';
import type { Camera, PageBox, Point, Size, SpreadMode, ZoomSpec } from '@embedpdf/stage-core';

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

export interface StageCapability {
  // selectors (pure reads)
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
  // intents (the only writers)
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
  home(): void;
}

export interface StageConfig {
  layout?: LayoutKind;
  framing?: FramingKind;
}

export const StageToken = createCapabilityToken<StageCapability>('stage');

const GAP = 16;
const FRAMINGS: Record<
  FramingKind,
  {
    bounded: boolean;
    overscroll: S.Overscroll;
    home: 'start' | 'center';
    margin: number;
    zoom: ZoomSpec;
  }
> = {
  document: {
    bounded: true,
    overscroll: 'center',
    home: 'start',
    margin: 24,
    zoom: { mode: S.ZoomMode.Automatic },
  },
  canvas: {
    bounded: false,
    overscroll: 0,
    home: 'center',
    margin: 0,
    zoom: { mode: S.ZoomMode.FitPage },
  },
};

export const stagePlugin = (config: StageConfig = {}) =>
  definePlugin<StageState, StageAction, StageCapability>({
    id: 'stage',
    token: StageToken,
    initialState: (): StageState => ({
      camera: { x: 0, y: 0, zoom: 1 },
      vp: { width: 0, height: 0 },
      layout: config.layout ?? 'vertical',
      spread: 'none',
      framing: config.framing ?? 'document',
      zoomSpec: FRAMINGS[config.framing ?? 'document'].zoom,
    }),
    reduce(state, a): StageState {
      switch (a.type) {
        case 'CAMERA':
          return { ...state, camera: a.camera };
        case 'VP':
          return { ...state, vp: a.vp };
        case 'LAYOUT':
          return {
            ...state,
            layout: a.layout,
            framing: a.layout === 'grid' ? 'canvas' : 'document',
          };
        case 'SPREAD':
          return { ...state, spread: a.spread };
        case 'FRAMING':
          return { ...state, framing: a.framing, zoomSpec: FRAMINGS[a.framing].zoom };
        case 'ZOOMSPEC':
          return { ...state, zoomSpec: a.zoomSpec };
        default:
          return state;
      }
    },
    capability(ctx: PluginContext<StageState, StageAction>): StageCapability {
      // scene cache: rebuild only when document / layout / spread change
      let sceneCache: { key: string; scene: S.Scene } | null = null;
      const buildScene = (): S.Scene => {
        const doc = ctx.core().document;
        const st = ctx.getState();
        const key = `${doc ? doc.pageCount : 0}|${st.layout}|${st.spread}`;
        if (sceneCache && sceneCache.key === key) return sceneCache.scene;
        const pages = doc ? doc.pages : [];
        const grouping = S.groupPages(pages.length, st.spread);
        const scene =
          st.layout === 'grid'
            ? S.gridLayout(pages, grouping, { gap: 56 })
            : st.layout === 'horizontal'
              ? S.linearLayout(pages, grouping, { axis: 'x', gap: GAP })
              : S.linearLayout(pages, grouping, { axis: 'y', gap: GAP });
        sceneCache = { key, scene };
        return scene;
      };

      const cam = () => ctx.getState().camera;
      const vp = () => ctx.getState().vp;
      const constraint = (): S.CameraConstraint => {
        const f = FRAMINGS[ctx.getState().framing];
        if (!f.bounded) return { bounded: false, overscroll: { x: 0, y: 0 } };
        const a = buildScene().axis;
        return {
          bounded: true,
          overscroll: {
            x: a === 'x' || a === 'grid' ? f.overscroll : 0,
            y: a === 'y' || a === 'grid' ? f.overscroll : 0,
          },
        };
      };
      const setCam = (next: Camera) =>
        ctx.dispatch({
          type: 'CAMERA',
          camera: S.clampCamera(next, buildScene().size, vp(), constraint()),
        });

      // memoized visiblePages -> stable reference (no useSyncExternalStore loop)
      let visSig = '';
      let vis: PageBox[] = [];
      const visiblePages = (): PageBox[] => {
        const c = cam();
        const v = vp();
        const sc = buildScene();
        const sig = `${c.x}/${c.y}/${c.zoom}/${v.width}/${v.height}/${sc.itemCount}`;
        if (sig === visSig) return vis;
        visSig = sig;
        vis = sc.query(S.cameraWorldRect(c, v)).flatMap((it) => it.pages);
        return vis;
      };

      const api: StageCapability = {
        camera: cam,
        viewport: vp,
        pageCount: () => ctx.core().document?.pageCount ?? 0,
        visiblePages,
        currentPage: () => S.anchorFromCamera(cam(), buildScene(), vp()).pageIndex,
        pageRect: (i) => {
          const sc = buildScene();
          const it = sc.items[sc.itemOfPage(i)];
          return it.pages.find((p) => p.pageIndex === i) ?? null;
        },
        toScreen: (w) => S.toScreen(cam(), w),
        toWorld: (s) => S.toWorld(cam(), s),
        layout: () => ctx.getState().layout,
        framing: () => ctx.getState().framing,
        spread: () => ctx.getState().spread,
        zoomLevel: () => cam().zoom,

        setViewport: (v) => ctx.dispatch({ type: 'VP', vp: v }),
        setCamera: setCam,
        panBy: (dx, dy) => setCam(S.panByScreen(cam(), dx, dy)),
        zoomAround: (pt, factor) => {
          setCam(S.zoomAround(cam(), pt, factor));
          ctx.dispatch({ type: 'ZOOMSPEC', zoomSpec: { level: cam().zoom } });
        },
        zoomTo: (spec) => {
          const sc = buildScene();
          const a = S.anchorFromCamera(cam(), sc, vp());
          ctx.dispatch({ type: 'ZOOMSPEC', zoomSpec: spec });
          const it = sc.items[sc.itemOfPage(a.pageIndex)];
          setCam(S.cameraFromAnchor(a, sc, vp(), S.resolveZoom(spec, it, vp(), GAP)));
        },
        zoomIn: () => api.zoomAround({ x: vp().width / 2, y: vp().height / 2 }, 1.2),
        zoomOut: () => api.zoomAround({ x: vp().width / 2, y: vp().height / 2 }, 1 / 1.2),
        fitWidth: () => api.zoomTo({ mode: S.ZoomMode.FitWidth }),
        fitPage: () => api.zoomTo({ mode: S.ZoomMode.FitPage }),
        goToPage: (i) => {
          const sc = buildScene();
          const it = sc.items[sc.itemOfPage(i)];
          const z = S.resolveZoom(ctx.getState().zoomSpec, it, vp(), GAP);
          setCam(S.centerOnWorld({ x: it.x + it.width / 2, y: it.y + it.height / 2 }, vp(), z));
        },
        setLayout: (layout) => {
          ctx.dispatch({ type: 'LAYOUT', layout });
          sceneCache = null;
          api.home();
        },
        setSpread: (spread) => {
          ctx.dispatch({ type: 'SPREAD', spread });
          sceneCache = null;
          api.home();
        },
        setFraming: (framing) => {
          ctx.dispatch({ type: 'FRAMING', framing });
          api.home();
        },
        home: () => {
          const sc = buildScene();
          const f = FRAMINGS[ctx.getState().framing];
          ctx.dispatch({ type: 'ZOOMSPEC', zoomSpec: f.zoom });
          const z = S.resolveZoom(f.zoom, sc.items[0], vp(), GAP);
          setCam(S.homeCamera(sc, vp(), z, { home: f.home, margin: f.margin }));
        },
      };
      return api;
    },
  });
