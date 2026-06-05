import * as S from '@embedpdf/stage-core';
import type { PageBox } from '@embedpdf/stage-core';
import type { PluginContext } from '@embedpdf/kernel';
import { FRAMINGS, GAP } from './framing';
import type { StageAction, StageCapability, StageState, StageViewState } from './types';

/**
 * The Stage capability — selectors (pure reads) + intents (the only writers).
 * All geometry comes from the pure `stage-core`; this layer just binds it to the
 * plugin's slice and the document. No DOM.
 */
export function createStageCapability(
  ctx: PluginContext<StageState, StageAction>,
): StageCapability {
  // Scene cache: rebuilt only when document / layout / spread change.
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
  const setCam = (next: S.Camera) =>
    ctx.dispatch({
      type: 'CAMERA',
      camera: S.clampCamera(next, buildScene().size, vp(), constraint()),
    });

  // Memoized visiblePages -> stable reference (no useSyncExternalStore tearing loop).
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
    // ── selectors ──
    camera: cam,
    viewport: vp,
    pageCount: () => ctx.core().document?.pageCount ?? 0,
    visiblePages,
    currentPage: () => S.anchorFromCamera(cam(), buildScene(), vp()).pageIndex,
    pageRect: (i) => {
      const sc = buildScene();
      return sc.items[sc.itemOfPage(i)].pages.find((p) => p.pageIndex === i) ?? null;
    },
    toScreen: (w) => S.toScreen(cam(), w),
    toWorld: (s) => S.toWorld(cam(), s),
    layout: () => ctx.getState().layout,
    framing: () => ctx.getState().framing,
    spread: () => ctx.getState().spread,
    zoomLevel: () => cam().zoom,
    viewState: (): StageViewState => {
      const st = ctx.getState();
      return {
        layout: st.layout,
        spread: st.spread,
        framing: st.framing,
        zoomSpec: st.zoomSpec,
        anchor: S.anchorFromCamera(cam(), buildScene(), vp()),
      };
    },

    // ── intents ──
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
    applyViewState: (view) => {
      ctx.dispatch({ type: 'SPREAD', spread: view.spread });
      ctx.dispatch({ type: 'LAYOUT', layout: view.layout });
      ctx.dispatch({ type: 'FRAMING', framing: view.framing });
      ctx.dispatch({ type: 'ZOOMSPEC', zoomSpec: view.zoomSpec });
      sceneCache = null;
      const sc = buildScene();
      const it = sc.items[sc.itemOfPage(view.anchor.pageIndex)];
      setCam(
        S.cameraFromAnchor(view.anchor, sc, vp(), S.resolveZoom(view.zoomSpec, it, vp(), GAP)),
      );
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
}
