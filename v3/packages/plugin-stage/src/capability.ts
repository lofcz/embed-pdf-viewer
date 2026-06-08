import * as S from '@embedpdf-x/stage-core';
import type { PluginContext } from '@embedpdf-x/kernel';
import { GAP } from './settings';
import type {
  Scheduler,
  StageAction,
  StageCapability,
  StageConfig,
  StageSettings,
  StageState,
  StageViewState,
  VisiblePage,
} from './types';

/**
 * The Stage capability — selectors (pure reads) + intents (the only writers).
 *
 * Layering, stated honestly:
 *   • stage-core — PURE spatial math (no DOM, no time). Ports to Rust later.
 *   • this capability — the IMPURE platform shell. It dispatches, caches, and owns
 *     the camera tween. It is NOT pure; the one host dependency it has (frame
 *     timing) enters through an injected Scheduler, never a hidden global.
 *
 * Every transition (layout / spread / zoom / bounds / resize) keeps the user looking
 * at the SAME page by capturing an Anchor and re-applying it.
 */
export function createStageCapability(
  ctx: PluginContext<StageState, StageAction>,
  config: StageConfig = {},
): StageCapability {
  // ── host timing seam (the only host dependency) ──────────────────────────────
  const host = globalThis as {
    requestAnimationFrame?: (cb: (t: number) => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };
  const canAnimate = !!config.scheduler || typeof host.requestAnimationFrame === 'function';
  const scheduler: Scheduler =
    config.scheduler ??
    (typeof host.requestAnimationFrame === 'function'
      ? { raf: (cb) => host.requestAnimationFrame!(cb), caf: (h) => host.cancelAnimationFrame!(h) }
      : { raf: () => 0, caf: () => {} }); // no host frames → goToPage jumps instantly

  // Scene cache: rebuilt only when document / layout / spread change.
  let sceneCache: { key: string; scene: S.Scene } | null = null;
  const buildScene = (): S.Scene => {
    const doc = ctx.document();
    const st = ctx.getState();
    const key = `${doc ? doc.pageCount : 0}|${st.layout}|${st.spread}|${st.sizing}`;
    if (sceneCache && sceneCache.key === key) return sceneCache.scene;
    const pages = doc ? doc.pages : [];
    const grouping = S.groupPages(pages.length, st.spread);
    const scene =
      st.layout === 'grid'
        ? S.gridLayout(pages, grouping, { gap: 56, sizing: st.sizing })
        : st.layout === 'horizontal'
          ? S.linearLayout(pages, grouping, { axis: 'x', gap: GAP, sizing: st.sizing })
          : S.linearLayout(pages, grouping, { axis: 'y', gap: GAP, sizing: st.sizing });
    sceneCache = { key, scene };
    return scene;
  };

  const cam = () => ctx.getState().camera;
  const vp = () => ctx.getState().vp;

  // Bounds + overscroll are explicit settings; overscroll applies only on the scroll
  // axis (both for grid). The cross axis just centres/locks.
  const constraint = (): S.CameraConstraint => {
    const st = ctx.getState();
    if (!st.bounded) return { bounded: false, overscroll: { x: 0, y: 0 } };
    const axis = buildScene().axis;
    return {
      bounded: true,
      overscroll: {
        x: axis === 'x' || axis === 'grid' ? st.overscroll : 0,
        y: axis === 'y' || axis === 'grid' ? st.overscroll : 0,
      },
    };
  };

  // The ONE low-level camera write: clamp, then dispatch. Used by every intent and
  // by the animator (which must NOT cancel itself — cancellation lives in intents).
  const setCam = (next: S.Camera) =>
    ctx.dispatch({
      type: 'CAMERA',
      camera: S.clampCamera(next, buildScene().size, vp(), constraint()),
    });

  // ── camera tween (impure shell concern; uses the injected Scheduler) ─────────
  let raf = 0;
  const cancelAnim = () => {
    if (raf) {
      scheduler.caf(raf);
      raf = 0;
    }
  };
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const animateTo = (target: S.Camera, ms = 240) => {
    if (!canAnimate) return setCam(target);
    cancelAnim();
    const from = cam();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    let started = false;
    let t0 = 0;
    const tick = (now: number) => {
      if (!started) {
        started = true;
        t0 = now; // anchor to the first real timestamp (works even when now === 0)
      }
      const k = ease(Math.min(1, (now - t0) / ms));
      setCam({
        x: lerp(from.x, target.x, k),
        y: lerp(from.y, target.y, k),
        zoom: lerp(from.zoom, target.zoom, k),
      });
      raf = k < 1 ? scheduler.raf(tick) : 0;
    };
    raf = scheduler.raf(tick);
  };

  // ── anchor: the durable "what am I looking at". Capture before any change,
  //    re-apply after — one mechanism for layout/spread/zoom/resize/restore. ─────
  const currentAnchor = (): S.Anchor => S.anchorFromCamera(cam(), buildScene(), vp());
  const applyAnchor = (anchor: S.Anchor) => {
    const scene = buildScene();
    const zoom = S.resolveZoom(ctx.getState().zoom, scene.maxItemSize, vp(), GAP);
    setCam(S.cameraFromAnchor(anchor, scene, vp(), zoom));
  };

  // pon (durable identity) for a page's display index, from the registry captured at open.
  const ponForIndex = (index: number): number =>
    ctx.document()?.pages[index]?.pageObjectNumber ?? index + 1;

  // Memoized visiblePages -> stable reference (no useSyncExternalStore tearing loop).
  let visSig = '';
  let vis: VisiblePage[] = [];
  const visiblePages = (): VisiblePage[] => {
    const c = cam();
    const v = vp();
    const sc = buildScene();
    const sig = `${c.x}/${c.y}/${c.zoom}/${v.width}/${v.height}/${sc.itemCount}`;
    if (sig === visSig) return vis;
    visSig = sig;
    vis = sc
      .query(S.cameraWorldRect(c, v))
      .flatMap((it) => it.pages)
      .map((box) => ({ ...box, pon: ponForIndex(box.pageIndex) }));
    return vis;
  };

  const snapshotSettings = (): StageSettings => {
    const s = ctx.getState();
    return {
      layout: s.layout,
      spread: s.spread,
      sizing: s.sizing,
      bounded: s.bounded,
      overscroll: s.overscroll,
      home: s.home,
      margin: s.margin,
      zoom: s.zoom,
      scrollBehavior: s.scrollBehavior,
    };
  };

  // Initial-view providers (persist, deep-link, an explicit prop…). One owner
  // (placeInitial) resolves them by priority — no effect-ordering races.
  const initialViewProviders: Array<{ priority: number; fn: () => StageViewState | null }> = [];
  let hasPlaced = false;

  const api: StageCapability = {
    // ── selectors ──
    camera: cam,
    viewport: vp,
    pageCount: () => ctx.document()?.pageCount ?? 0,
    visiblePages,
    currentPage: () => S.anchorFromCamera(cam(), buildScene(), vp()).pageIndex,
    pageRect: (pon) => {
      const meta = ctx.document();
      const index = meta ? meta.pages.findIndex((p) => p.pageObjectNumber === pon) : -1;
      if (index < 0) return null;
      const sc = buildScene();
      const box = sc.items[sc.itemOfPage(index)].pages.find((p) => p.pageIndex === index);
      return box ? { ...box, pon } : null;
    },
    toScreen: (w) => S.toScreen(cam(), w),
    toWorld: (s) => S.toWorld(cam(), s),
    layout: () => ctx.getState().layout,
    spread: () => ctx.getState().spread,
    sizing: () => ctx.getState().sizing,
    bounded: () => ctx.getState().bounded,
    overscroll: () => ctx.getState().overscroll,
    home: () => ctx.getState().home,
    margin: () => ctx.getState().margin,
    scrollBehavior: () => ctx.getState().scrollBehavior,
    zoomLevel: () => cam().zoom,
    zoomMode: () => {
      const z = ctx.getState().zoom;
      return 'mode' in z ? z.mode : 'custom';
    },
    settings: snapshotSettings,
    viewState: (): StageViewState => ({
      ...snapshotSettings(),
      anchor: S.anchorFromCamera(cam(), buildScene(), vp()),
    }),

    // ── intents ──
    setViewport: (v) => {
      // First real size: placeInitial (persist/reset) owns it. Afterwards every
      // resize keeps the same page and re-resolves fit-modes (fit-page stays fit).
      if (!hasPlaced) {
        ctx.dispatch({ type: 'VP', vp: v });
        return;
      }
      cancelAnim();
      const anchor = currentAnchor(); // measured against the OLD viewport
      ctx.dispatch({ type: 'VP', vp: v }); // new viewport
      applyAnchor(anchor);
    },
    setCamera: (c) => {
      cancelAnim();
      setCam(c);
    },
    panBy: (dx, dy) => {
      cancelAnim();
      setCam(S.panByScreen(cam(), dx, dy));
    },
    zoomAround: (pt, factor) => {
      cancelAnim();
      setCam(S.zoomAround(cam(), pt, factor));
      // record the resulting fixed level as the zoom intent — focal, so NO re-anchor.
      ctx.dispatch({ type: 'PATCH', patch: { zoom: { level: cam().zoom } } });
    },
    zoomIn: () => api.zoomAround({ x: vp().width / 2, y: vp().height / 2 }, 1.2),
    zoomOut: () => api.zoomAround({ x: vp().width / 2, y: vp().height / 2 }, 1 / 1.2),
    zoomTo: (spec) => api.update({ zoom: spec }),
    fitWidth: () => api.update({ zoom: { mode: S.ZoomMode.FitWidth } }),
    fitPage: () => api.update({ zoom: { mode: S.ZoomMode.FitPage } }),
    automatic: () => api.update({ zoom: { mode: S.ZoomMode.Automatic } }),
    goToPage: (index, opts) => {
      cancelAnim();
      const sc = buildScene();
      const st = ctx.getState();
      const it = sc.items[sc.itemOfPage(index)];
      const z = S.resolveZoom(st.zoom, sc.maxItemSize, vp(), GAP);
      // Align to the page's START (top for vertical, left for horizontal) — the
      // conventional "scroll to the top of the page", per the `home` setting.
      const target = S.clampCamera(
        S.itemCamera(it, sc, vp(), z, { align: st.home, margin: st.margin }),
        sc.size,
        vp(),
        constraint(),
      );
      if ((opts?.behavior ?? st.scrollBehavior) === 'smooth') animateTo(target);
      else setCam(target);
    },
    update: (patch) => {
      cancelAnim();
      const anchor = currentAnchor(); // capture against the current scene/viewport
      ctx.dispatch({ type: 'PATCH', patch });
      const structural =
        patch.layout !== undefined || patch.spread !== undefined || patch.sizing !== undefined;
      if (structural) sceneCache = null;
      if (structural || patch.zoom !== undefined) {
        applyAnchor(anchor); // rebuild + keep page + re-fit (also re-clamps)
      } else if (patch.bounded !== undefined || patch.overscroll !== undefined) {
        setCam(cam()); // bounds changed: just re-clamp the current camera in place
      }
      // home / margin / scrollBehavior: no camera effect
    },
    setLayout: (layout) => api.update({ layout }),
    setSpread: (spread) => api.update({ spread }),
    setSizing: (sizing) => api.update({ sizing }),
    setBounded: (bounded) => api.update({ bounded }),
    setOverscroll: (overscroll) => api.update({ overscroll }),
    setHome: (home) => api.update({ home }),
    setMargin: (margin) => api.update({ margin }),
    setScrollBehavior: (behavior) => api.update({ scrollBehavior: behavior }),
    applyViewState: (view) => {
      cancelAnim();
      ctx.dispatch({
        type: 'PATCH',
        patch: {
          layout: view.layout,
          spread: view.spread,
          sizing: view.sizing,
          bounded: view.bounded,
          overscroll: view.overscroll,
          home: view.home,
          margin: view.margin,
          zoom: view.zoom,
          scrollBehavior: view.scrollBehavior,
        },
      });
      sceneCache = null;
      applyAnchor(view.anchor);
    },
    provideInitialView: (priority, fn) => {
      initialViewProviders.push({ priority, fn });
    },
    placeInitial: () => {
      hasPlaced = true;
      const sorted = [...initialViewProviders].sort((a, b) => b.priority - a.priority);
      for (const p of sorted) {
        const view = p.fn();
        if (view) {
          api.applyViewState(view);
          return;
        }
      }
      api.resetView();
    },
    resetView: () => {
      cancelAnim();
      const sc = buildScene();
      const st = ctx.getState();
      const z = S.resolveZoom(st.zoom, sc.maxItemSize, vp(), GAP);
      setCam(S.homeCamera(sc, vp(), z, { home: st.home, margin: st.margin }));
    },
  };
  return api;
}
