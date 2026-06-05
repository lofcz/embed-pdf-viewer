// @ts-check
/**
 * The Stage plugin — the unified coordinate core. This is where v2's scroll +
 * viewport + zoom + pan + spread collapse into ONE plugin built on the pure
 * stage-core (Scene + Camera + Anchor). It owns no DOM; it exposes intents
 * (goToPage, zoomTo, panBy…) and selectors (camera, visiblePages, pageRect…).
 */
import { createCapabilityToken, definePlugin } from './kernel.js';
import * as S from '../stage-core/stage-core.js';

/** @typedef {import('./kernel.js').CapabilityToken<StageCapability>} _ */
export const StageToken = createCapabilityToken('stage');

const GAP = 16;
const FRAMINGS = {
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

export const stagePlugin = (config = {}) =>
  definePlugin({
    id: 'stage',
    token: StageToken,
    initialState: () => ({
      camera: { x: 0, y: 0, zoom: 1 },
      vp: { width: 0, height: 0 },
      layout: config.layout ?? 'vertical',
      spread: 'none',
      framing: config.framing ?? 'document',
      zoomSpec: FRAMINGS[config.framing ?? 'document'].zoom,
    }),
    reduce(state, a) {
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
    capability(ctx) {
      // ---- scene cache (rebuild only when document/layout/spread change) ----
      let sceneCache = null;
      const buildScene = () => {
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
      const constraint = () => {
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
      const setCam = (next) =>
        ctx.dispatch({
          type: 'CAMERA',
          camera: S.clampCamera(next, buildScene().size, vp(), constraint()),
        });

      // ---- memoized visiblePages (stable ref => no useSyncExternalStore loop) ----
      let visSig = null,
        vis = [];
      const visiblePages = () => {
        const c = cam(),
          v = vp(),
          sc = buildScene();
        const sig = `${c.x}/${c.y}/${c.zoom}/${v.width}/${v.height}/${sc.itemCount}`;
        if (sig === visSig) return vis;
        visSig = sig;
        vis = sc.query(S.cameraWorldRect(c, v)).flatMap((it) => it.pages);
        return vis;
      };

      const api = {
        // ----- selectors (pure reads) -----
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

        // ----- intents (the only writers) -----
        setViewport: (v) => ctx.dispatch({ type: 'VP', vp: v }),
        setCamera: setCam,
        panBy: (dx, dy) => setCam(S.panByScreen(cam(), dx, dy)),
        zoomAround: (pt, factor) => {
          setCam(S.zoomAround(cam(), pt, factor));
          ctx.dispatch({ type: 'ZOOMSPEC', zoomSpec: { level: cam().zoom } });
        },
        zoomTo(spec) {
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
        setLayout(layout) {
          ctx.dispatch({ type: 'LAYOUT', layout });
          sceneCache = null;
          api.home();
        },
        setSpread(spread) {
          ctx.dispatch({ type: 'SPREAD', spread });
          sceneCache = null;
          api.home();
        },
        setFraming(framing) {
          ctx.dispatch({ type: 'FRAMING', framing });
          api.home();
        },
        home() {
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

/** @typedef {ReturnType<ReturnType<typeof stagePlugin>['capability']>} StageCapability */
