import * as S from '@embedpdf-x/stage-core';
import type { PluginContext } from '@embedpdf-x/kernel';
import { GAP } from './settings';
import type {
  Scheduler,
  ScrollBehaviorKind,
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

  const cam = () => ctx.getState().camera;
  const vp = () => ctx.getState().vp;
  const paged = () => ctx.getState().flow === 'paged';

  // ── the document's item model (spread grouping) — independent of the rendered
  //    scene, so paged navigation can reason about ALL items while the SCENE holds
  //    only one. Cursor is a page; itemIndexOfPage maps it (survives regrouping). ──
  let groupingCache: { key: string; grouping: number[][]; firstPages: number[] } | null = null;
  const grouping = (): { grouping: number[][]; firstPages: number[] } => {
    const doc = ctx.document();
    const st = ctx.getState();
    const key = `${doc ? doc.pageCount : 0}|${st.spread}`;
    if (groupingCache && groupingCache.key === key) return groupingCache;
    const g = S.groupPages(doc ? doc.pageCount : 0, st.spread);
    groupingCache = { key, grouping: g, firstPages: g.map((item) => item[0]) };
    return groupingCache;
  };
  const itemCountFull = (): number => grouping().grouping.length;
  const itemIndexOfPage = (pageIndex: number): number => {
    const fp = grouping().firstPages;
    let lo = 0;
    let hi = fp.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fp[mid] <= pageIndex) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, lo - 1);
  };

  const layoutFor = (groups: number[][]): S.Scene => {
    const st = ctx.getState();
    const pages = ctx.document()?.pages ?? [];
    return st.layout === 'grid'
      ? S.gridLayout(pages, groups, { gap: 56, sizing: st.sizing })
      : st.layout === 'horizontal'
        ? S.linearLayout(pages, groups, { axis: 'x', gap: GAP, sizing: st.sizing })
        : S.linearLayout(pages, groups, { axis: 'y', gap: GAP, sizing: st.sizing });
  };

  // Scene cache. Continuous = the whole document. Paged = a ONE-ITEM SLICE at the
  // origin containing only the cursor's item — so isolation is STRUCTURAL (no other
  // page exists to leak), unbounded pan is free, and coordinates stay local.
  let sceneCache: { key: string; scene: S.Scene } | null = null;
  const buildScene = (): S.Scene => {
    const doc = ctx.document();
    const st = ctx.getState();
    const { grouping: g } = grouping();
    if (st.flow === 'paged') {
      const idx = g.length ? Math.min(itemIndexOfPage(st.cursor), g.length - 1) : 0;
      const key = `paged|${st.layout}|${st.sizing}|${idx}`;
      if (sceneCache && sceneCache.key === key) return sceneCache.scene;
      const scene = layoutFor(g.length ? [g[idx]] : []);
      sceneCache = { key, scene };
      return scene;
    }
    const key = `cont|${doc ? doc.pageCount : 0}|${st.layout}|${st.spread}|${st.sizing}`;
    if (sceneCache && sceneCache.key === key) return sceneCache.scene;
    const scene = layoutFor(g);
    sceneCache = { key, scene };
    return scene;
  };

  // Bounds + overscroll are explicit settings; overscroll applies only on the scroll
  // axis (both for grid). Paged forces overscroll 0 so a single page's edge is crisp.
  const constraint = (): S.CameraConstraint => {
    const st = ctx.getState();
    if (!st.bounded) return { bounded: false, overscroll: { x: 0, y: 0 } };
    if (st.flow === 'paged') return { bounded: true, overscroll: { x: 0, y: 0 } };
    const axis = buildScene().axis;
    return {
      bounded: true,
      overscroll: {
        x: axis === 'x' || axis === 'grid' ? st.overscroll : 0,
        y: axis === 'y' || axis === 'grid' ? st.overscroll : 0,
      },
    };
  };

  // ── continuous ↔ paged parameterizations ────────────────────────────────────
  // Paged shrinks the clamp rect and fit-box to the current item. In paged the scene
  // IS one item, so `currentItem` is just `items[0]` (which page it is comes from the
  // cursor, set only by navigation). In continuous it's derived from the camera.
  const sceneRect = (): S.Rect => {
    const { width, height } = buildScene().size;
    return { x: 0, y: 0, width, height };
  };
  const itemRect = (it: S.SceneItem): S.Rect => ({
    x: it.x,
    y: it.y,
    width: it.width,
    height: it.height,
  });
  const currentItem = (): S.SceneItem => {
    const sc = buildScene();
    return paged()
      ? sc.items[0]
      : sc.nearestItem(S.toWorld(cam(), { x: vp().width / 2, y: vp().height / 2 }));
  };
  /** Index of the current item in the FULL document (paged ← cursor; continuous ← camera). */
  const currentFullItemIndex = (): number => {
    if (paged()) return itemIndexOfPage(ctx.getState().cursor);
    const sc = buildScene();
    return sc.itemCount
      ? sc.nearestItem(S.toWorld(cam(), { x: vp().width / 2, y: vp().height / 2 })).index
      : 0;
  };
  /** Clamp rect for a camera write that TARGETS this item (scene-wide in continuous). */
  const boundsFor = (it: S.SceneItem): S.Rect => (paged() ? itemRect(it) : sceneRect());
  /** Fit-box for resolving zoom when targeting this item (doc-max in continuous). */
  const fitFor = (it: S.SceneItem): S.Size =>
    paged() ? { width: it.width, height: it.height } : buildScene().maxItemSize;
  /** Clamp rect for a "stay" write (pan/zoom): the item the camera is currently on. */
  const stayBounds = (): S.Rect => (paged() ? itemRect(currentItem()) : sceneRect());

  // The ONE low-level camera write: clamp to `bounds`, then dispatch. Every write
  // NAMES its target item's rect — "stay" ops default to the current item, repositions
  // pass their explicit target — so clamp/fit are always derived, never stale.
  const setCam = (next: S.Camera, bounds: S.Rect = stayBounds()) =>
    ctx.dispatch({
      type: 'CAMERA',
      camera: S.clampCamera(next, bounds, vp(), constraint()),
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
  // The tween clamps to an EXPLICIT bounds rect every frame (never a re-derived
  // current item), so animating toward a different item isn't clamped back.
  const animateTo = (target: S.Camera, bounds: S.Rect, ms = 240) => {
    if (!canAnimate) return setCam(target, bounds);
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
      setCam(
        {
          x: lerp(from.x, target.x, k),
          y: lerp(from.y, target.y, k),
          zoom: lerp(from.zoom, target.zoom, k),
        },
        bounds,
      );
      raf = k < 1 ? scheduler.raf(tick) : 0;
    };
    raf = scheduler.raf(tick);
  };

  // ── anchor: the durable "what am I looking at". Capture before any change,
  //    re-apply after — one mechanism for layout/spread/zoom/resize/restore.
  //    fit-box and clamp rect come from the ANCHOR's item (correct whether we're
  //    staying on the current page or restoring a saved, different one). ──────────
  const currentAnchor = (): S.Anchor => S.anchorFromCamera(cam(), buildScene(), vp());
  const applyAnchor = (anchor: S.Anchor) => {
    const scene = buildScene();
    const item = scene.items[scene.itemOfPage(anchor.pageIndex)];
    const zoom = S.resolveZoom(ctx.getState().zoom, fitFor(item), vp(), GAP);
    setCam(S.cameraFromAnchor(anchor, scene, vp(), zoom), boundsFor(item));
  };

  // Navigate to a FULL-document item index — the unifying primitive. Paged moves the
  // cursor (rebuilding the one-item slice) then places it; continuous scrolls to it in
  // the full scene. Both align to the page start at the resolved zoom.
  const goToItem = (fullItemIndex: number, opts?: { behavior?: ScrollBehaviorKind }) => {
    cancelAnim();
    const idx = Math.max(0, Math.min(fullItemIndex, itemCountFull() - 1));
    if (paged()) {
      const newCursor = grouping().grouping[idx]?.[0] ?? 0;
      if (newCursor !== ctx.getState().cursor) ctx.dispatch({ type: 'CURSOR', cursor: newCursor });
    }
    const sc = buildScene(); // paged: the slice for the new cursor; continuous: full scene
    const item = paged() ? sc.items[0] : sc.items[idx];
    if (!item) return;
    const st = ctx.getState();
    const zoom = S.resolveZoom(st.zoom, fitFor(item), vp(), GAP);
    const bounds = boundsFor(item);
    const target = S.clampCamera(
      S.itemCamera(item, sc, vp(), zoom, { align: st.home, margin: st.margin }),
      bounds,
      vp(),
      constraint(),
    );
    if ((opts?.behavior ?? st.scrollBehavior) === 'smooth') animateTo(target, bounds);
    else setCam(target, bounds);
  };

  // pon (durable identity) for a page's display index, from the registry captured at open.
  const ponForIndex = (index: number): number =>
    ctx.document()?.pages[index]?.pageObjectNumber ?? index + 1;

  // Memoized visiblePages -> stable reference (no useSyncExternalStore tearing loop).
  // Paged renders ONLY the current item; continuous renders the camera's query window.
  // The signature keys on the scene-cache key (layout/spread/sizing/pages), flow,
  // camera and viewport — so layout/spread changes can't serve stale pages.
  let visSig = '';
  let vis: VisiblePage[] = [];
  const visiblePages = (): VisiblePage[] => {
    const c = cam();
    const v = vp();
    const sc = buildScene();
    // paged: the slice's single item (or none if no pages); continuous: the query window.
    const items = paged() ? sc.items.slice(0, 1) : sc.query(S.cameraWorldRect(c, v));
    const sig = `${sceneCache!.key}|${ctx.getState().flow}|${c.x},${c.y},${c.zoom}|${v.width}x${v.height}`;
    if (sig === visSig) return vis;
    visSig = sig;
    vis = items
      .flatMap((it) => it.pages)
      .map((box) => ({ ...box, pon: ponForIndex(box.pageIndex) }));
    return vis;
  };

  const snapshotSettings = (): StageSettings => {
    const s = ctx.getState();
    return {
      flow: s.flow,
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
    currentPage: () => {
      const sc = buildScene();
      return sc.itemCount ? S.anchorFromCamera(cam(), sc, vp()).pageIndex : 0;
    },
    currentItemPages: () => (buildScene().itemCount ? [...currentItem().pageIndexes] : []),
    pages: () =>
      (ctx.document()?.pages ?? []).map((p) => ({
        index: p.index,
        pon: p.pageObjectNumber,
        label: p.label ?? null,
      })),
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
    flow: () => ctx.getState().flow,
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
      cursor: ctx.getState().cursor,
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
    goToPage: (index, opts) => goToItem(itemIndexOfPage(index), opts),
    next: (opts) => goToItem(currentFullItemIndex() + 1, opts),
    prev: (opts) => goToItem(currentFullItemIndex() - 1, opts),
    update: (patch) => {
      cancelAnim();
      const anchor = currentAnchor(); // capture (page-durable) against the current scene
      ctx.dispatch({ type: 'PATCH', patch });
      const structural =
        patch.layout !== undefined || patch.spread !== undefined || patch.sizing !== undefined;
      if (structural) sceneCache = null;
      if (patch.flow !== undefined) {
        // flow toggled: re-place onto the SAME page under the new flow's scene. By page
        // (not item index) so it survives a simultaneous spread/layout change, and it
        // seeds the paged cursor.
        goToItem(itemIndexOfPage(anchor.pageIndex), { behavior: 'instant' });
      } else if (structural || patch.zoom !== undefined) {
        applyAnchor(anchor); // rebuild + keep page + re-fit (also re-clamps)
      } else if (patch.bounded !== undefined || patch.overscroll !== undefined) {
        setCam(cam()); // bounds changed: just re-clamp the current camera in place
      }
      // home / margin / scrollBehavior: no camera effect
    },
    setFlow: (flow) => api.update({ flow }),
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
          flow: view.flow,
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
      ctx.dispatch({ type: 'CURSOR', cursor: view.cursor ?? 0 });
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
    // Home = the first item. Uniform: continuous scrolls to page 0 top; paged sets
    // the cursor to page 0 and places it.
    resetView: () => goToItem(0, { behavior: 'instant' }),
  };
  return api;
}
