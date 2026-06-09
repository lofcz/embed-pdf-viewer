import * as S from '@embedpdf-x/stage-core';
import type { PluginContext } from '@embedpdf-x/kernel';
import type {
  GoToOptions,
  Scheduler,
  StageAction,
  StageCapability,
  StageConfig,
  StageSettings,
  StageState,
  StageViewState,
  Viewpoint,
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
 * The model rests on one geometric question — "does it fit the viewport?":
 *   • centering: an arrival is centered when its subject fits, start-aligned when
 *     it overflows (the clamp's fit-case — see stage-core placeCamera).
 *   • step size: next/prev step by ITEM (spread) when the item fits, by PAGE when
 *     zoomed in past it.
 *   • subject:   you arrive AT the unit that fits (item, page — or the whole scene
 *     under fit-all).
 *
 * The `cursor` is THE current page in both flows: navigation sets it; continuous
 * scrolling syncs it from the camera; paged panning never moves it.
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
      : { raf: () => 0, caf: () => {} }); // no host frames → navigation jumps instantly

  const cam = () => ctx.getState().camera;
  const vp = () => ctx.getState().vp;
  const pad = () => ctx.getState().padding;
  const paged = () => ctx.getState().flow === 'paged';
  const isFitAll = () => {
    const z = ctx.getState().zoom;
    return 'mode' in z && z.mode === S.ZoomMode.FitAll;
  };

  // ── the document's item model (spread grouping) — independent of the rendered
  //    scene, so navigation can reason about ALL items while a paged SCENE holds
  //    only one. The cursor is a page; itemIndexOfPage maps it (survives regrouping).
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
      ? S.gridLayout(pages, groups, { gap: st.gap, sizing: st.sizing, direction: st.direction })
      : st.layout === 'horizontal'
        ? S.linearLayout(pages, groups, {
            axis: 'x',
            gap: st.gap,
            sizing: st.sizing,
            direction: st.direction,
          })
        : S.linearLayout(pages, groups, {
            axis: 'y',
            gap: st.gap,
            sizing: st.sizing,
            direction: st.direction,
          });
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
      const key = `paged|${st.layout}|${st.sizing}|${st.spread}|${st.gap}|${st.direction}|${idx}`;
      if (sceneCache && sceneCache.key === key) return sceneCache.scene;
      const scene = layoutFor(g.length ? [g[idx]] : []);
      sceneCache = { key, scene };
      return scene;
    }
    const key = `cont|${doc ? doc.pageCount : 0}|${st.layout}|${st.spread}|${st.sizing}|${st.gap}|${st.direction}`;
    if (sceneCache && sceneCache.key === key) return sceneCache.scene;
    const scene = layoutFor(g);
    sceneCache = { key, scene };
    return scene;
  };

  // ── geometry helpers ──────────────────────────────────────────────────────────
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
  const pageRectOf = (it: S.SceneItem, pageIndex: number): S.Rect => {
    const box = it.pages.find((p) => p.pageIndex === pageIndex) ?? it.pages[0];
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };
  /** The item shown for the cursor: the slice's only item (paged) / the full-scene item. */
  const cursorItem = (): S.SceneItem => {
    const sc = buildScene();
    return paged() ? sc.items[0] : sc.items[itemIndexOfPage(ctx.getState().cursor)];
  };

  // THE predicate. "Does this rect fit the padded viewport at this zoom?" decides
  // centering (via the clamp), the navigation step size, and the arrival subject.
  const fits = (rect: S.Rect, zoom: number): boolean => {
    const v = vp();
    const p = pad();
    const eps = 0.5;
    return (
      rect.width * zoom <= v.width - 2 * p + eps && rect.height * zoom <= v.height - 2 * p + eps
    );
  };
  /** Fit-box for resolving the zoom intent: whole scene (fit-all), the current item
   *  (paged — per-page fit), or the document max (continuous — doc-stable zoom). */
  const fitBox = (item: S.SceneItem): S.Size => {
    if (isFitAll()) return buildScene().size;
    return paged() ? { width: item.width, height: item.height } : buildScene().maxItemSize;
  };
  /** Clamp rect for a camera write targeting this item (scene-wide in continuous). */
  const boundsFor = (it: S.SceneItem): S.Rect => (paged() ? itemRect(it) : sceneRect());
  /** Clamp rect for a "stay" write (pan/zoom): the slice item (paged) / the scene. */
  const stayBounds = (): S.Rect => (paged() ? itemRect(buildScene().items[0]) : sceneRect());

  const constraint = (): S.CameraConstraint => ({
    bounded: ctx.getState().bounded,
    padding: pad(),
  });

  // The ONE low-level camera write: clamp to `bounds`, dispatch. MECHANISM only —
  // it never touches the cursor (see syncCursorFromCamera for the policy).
  const setCam = (next: S.Camera, bounds: S.Rect = stayBounds()) => {
    ctx.dispatch({ type: 'CAMERA', camera: S.clampCamera(next, bounds, vp(), constraint()) });
  };

  /**
   * Cursor reconciliation, one direction per interaction:
   *   navigation  → cursor is INTENT, set explicitly; the camera honors it as far
   *                 as the clamp allows — and a clamped camera never revokes it.
   *   manipulation → (pan / drag / pinch) the camera moves freely; the cursor is
   *                 DERIVED from it. Only those verbs call this. Paged never syncs.
   */
  const syncCursorFromCamera = () => {
    if (paged()) return;
    const sc = buildScene();
    if (!sc.itemCount) return;
    const page = S.anchorFromCamera(cam(), sc, vp()).pageIndex;
    if (page !== ctx.getState().cursor) ctx.dispatch({ type: 'CURSOR', cursor: page });
  };

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

  // ── anchor: the durable "what am I looking at". Capture before a structural
  //    change, re-apply after — one mechanism for layout/spread/zoom/resize/restore.
  const currentAnchor = (): S.Anchor => {
    const sc = buildScene();
    return sc.itemCount
      ? S.anchorFromCamera(cam(), sc, vp())
      : { pageIndex: ctx.getState().cursor, fx: 0.5, fy: 0 };
  };
  const applyAnchor = (anchor: S.Anchor) => {
    const scene = buildScene();
    if (!scene.itemCount) return;
    const item = scene.items[scene.itemOfPage(anchor.pageIndex)];
    const zoom = S.resolveZoom(ctx.getState().zoom, fitBox(item), vp(), pad());
    setCam(S.cameraFromAnchor(anchor, scene, vp(), zoom), boundsFor(item));
  };
  /**
   * Re-apply the view after a structural/zoom/viewport change. Normally anchor-
   * preserving (keep looking at the same spot). Under fit-all the subject is the
   * WHOLE scene, so "keep my anchor" is meaningless — re-place instead (this is
   * what centers the scene even when unbounded).
   */
  const reapply = (anchor: S.Anchor) => {
    if (isFitAll()) goToTarget(ctx.getState().cursor, { behavior: 'instant' });
    else applyAnchor(anchor);
  };

  // ── navigation: ONE arrival procedure for goToPage / next / prev / reset ─────
  // Navigation is CANONICAL: goToPage(N) always ends in the same camera state,
  // regardless of where you came from or what happens to be visible (no
  // visibility-dependent behavior — that's a discontinuity at the fit threshold).
  // 1. move the cursor to the target page (paged: rebuilds the one-item slice),
  // 2. choose the SUBJECT by the fits-predicate (scene under fit-all; the item if
  //    it fits; else the page),
  // 3. placeCamera(subject): centered when it fits, start-aligned when it overflows.
  // The legitimate "nothing moves" cases are STRUCTURAL, not conditional: under
  // fit-all the canonical placement is the centered scene, which doesn't change.
  const goToTarget = (pageIndex: number, opts?: GoToOptions) => {
    cancelAnim();
    const doc = ctx.document();
    if (!doc || doc.pageCount === 0) return;
    const target = Math.max(0, Math.min(pageIndex, doc.pageCount - 1));
    if (target !== ctx.getState().cursor) ctx.dispatch({ type: 'CURSOR', cursor: target });

    // Restore path (per-page view memory): exact viewpoint instead of fresh placement.
    if (opts?.viewpoint) {
      ctx.dispatch({ type: 'PATCH', patch: { zoom: opts.viewpoint.zoom } });
      applyAnchor(opts.viewpoint.anchor);
      return;
    }

    const sc = buildScene(); // paged: the (possibly new) slice; continuous: full scene
    if (!sc.itemCount) return;
    const item = paged() ? sc.items[0] : sc.items[itemIndexOfPage(target)];
    const zoom = S.resolveZoom(ctx.getState().zoom, fitBox(item), vp(), pad());
    const subject = isFitAll()
      ? sceneRect()
      : fits(itemRect(item), zoom)
        ? itemRect(item)
        : pageRectOf(item, target);

    const camera = S.placeCamera(
      subject,
      vp(),
      zoom,
      pad(),
      ctx.getState().align,
      ctx.getState().direction,
    );
    const bounds = boundsFor(item);
    if ((opts?.behavior ?? ctx.getState().scrollBehavior) === 'smooth') animateTo(camera, bounds);
    else setCam(camera, bounds);
  };

  /** Step by the navigation unit: the ITEM when it fits the viewport, else the PAGE. */
  const step = (direction: 1 | -1, opts?: GoToOptions) => {
    const st = ctx.getState();
    const item = cursorItem();
    if (!item) return;
    const { grouping: g } = grouping();
    if (isFitAll() || fits(itemRect(item), cam().zoom)) {
      const idx = Math.max(0, Math.min(itemIndexOfPage(st.cursor) + direction, g.length - 1));
      goToTarget(g[idx][0], opts);
    } else {
      goToTarget(st.cursor + direction, opts);
    }
  };

  // pon (durable identity) for a page's display index, from the registry captured at open.
  const ponForIndex = (index: number): number =>
    ctx.document()?.pages[index]?.pageObjectNumber ?? index + 1;

  // Memoized visiblePages -> stable reference (no useSyncExternalStore tearing loop).
  // Paged renders ONLY the slice's item; continuous renders the camera's query window.
  let visSig = '';
  let vis: VisiblePage[] = [];
  const visiblePages = (): VisiblePage[] => {
    const c = cam();
    const v = vp();
    const sc = buildScene();
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
      padding: s.padding,
      gap: s.gap,
      direction: s.direction,
      align: s.align,
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
    currentPage: () => ctx.getState().cursor,
    currentItemPages: () => {
      const item = cursorItem();
      return item ? [...item.pageIndexes] : [];
    },
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
      if (!sc.itemCount) return null;
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
    padding: () => ctx.getState().padding,
    gap: () => ctx.getState().gap,
    align: () => ctx.getState().align,
    direction: () => ctx.getState().direction,
    scrollBehavior: () => ctx.getState().scrollBehavior,
    zoomLevel: () => cam().zoom,
    zoomMode: () => {
      const z = ctx.getState().zoom;
      return 'mode' in z ? z.mode : 'custom';
    },
    viewpoint: (): Viewpoint => ({ anchor: currentAnchor(), zoom: ctx.getState().zoom }),
    settings: snapshotSettings,
    viewState: (): StageViewState => ({
      ...snapshotSettings(),
      cursor: ctx.getState().cursor,
      anchor: currentAnchor(),
    }),

    // ── intents ──
    setViewport: (v) => {
      // First real size: placeInitial (persist/reset) owns it. Afterwards every
      // resize keeps the same page and re-resolves fit-modes (fit stays fit).
      if (!hasPlaced) {
        ctx.dispatch({ type: 'VP', vp: v });
        return;
      }
      cancelAnim();
      const anchor = currentAnchor(); // measured against the OLD viewport
      ctx.dispatch({ type: 'VP', vp: v }); // new viewport
      reapply(anchor);
    },
    setCamera: (c) => {
      cancelAnim();
      setCam(c);
      syncCursorFromCamera();
    },
    panBy: (dx, dy) => {
      cancelAnim();
      setCam(S.panByScreen(cam(), dx, dy));
      syncCursorFromCamera();
    },
    zoomAround: (pt, factor) => {
      cancelAnim();
      setCam(S.zoomAround(cam(), pt, factor));
      // record the resulting fixed level as the zoom intent — focal, so NO re-anchor.
      ctx.dispatch({ type: 'PATCH', patch: { zoom: { level: cam().zoom } } });
      syncCursorFromCamera();
    },
    zoomIn: () => api.zoomAround({ x: vp().width / 2, y: vp().height / 2 }, 1.2),
    zoomOut: () => api.zoomAround({ x: vp().width / 2, y: vp().height / 2 }, 1 / 1.2),
    zoomTo: (spec) => api.update({ zoom: spec }),
    fitWidth: () => api.update({ zoom: { mode: S.ZoomMode.FitWidth } }),
    fitPage: () => api.update({ zoom: { mode: S.ZoomMode.FitPage } }),
    fitAll: () => api.update({ zoom: { mode: S.ZoomMode.FitAll } }),
    automatic: () => api.update({ zoom: { mode: S.ZoomMode.Automatic } }),
    goToPage: (pageIndex, opts) => goToTarget(pageIndex, opts),
    next: (opts) => step(1, opts),
    prev: (opts) => step(-1, opts),
    update: (patch) => {
      cancelAnim();
      const anchor = currentAnchor(); // capture (page-durable) against the current scene
      ctx.dispatch({ type: 'PATCH', patch });
      const structural =
        patch.layout !== undefined ||
        patch.spread !== undefined ||
        patch.sizing !== undefined ||
        patch.gap !== undefined ||
        patch.direction !== undefined;
      if (structural) sceneCache = null;
      if (patch.flow !== undefined) {
        // flow toggled: re-place onto the cursor's page under the new flow's scene
        // (the camera's coordinates are meaningless across the flow boundary).
        goToTarget(ctx.getState().cursor, { behavior: 'instant' });
      } else if (structural || patch.zoom !== undefined) {
        reapply(anchor); // rebuild + keep page + re-fit (fit-all: re-place the scene)
      } else if (patch.bounded !== undefined || patch.padding !== undefined) {
        setCam(cam()); // bounds changed: just re-clamp the current camera in place
      }
      // scrollBehavior: no camera effect
    },
    setFlow: (flow) => api.update({ flow }),
    setLayout: (layout) => api.update({ layout }),
    setSpread: (spread) => api.update({ spread }),
    setSizing: (sizing) => api.update({ sizing }),
    setBounded: (bounded) => api.update({ bounded }),
    setPadding: (padding) => api.update({ padding }),
    setGap: (gap) => api.update({ gap }),
    setAlign: (align) => api.update({ align }),
    setDirection: (direction) => api.update({ direction }),
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
          padding: view.padding,
          gap: view.gap,
          direction: view.direction,
          align: view.align,
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
    // Home = page 0, placed by the unit rule (centers what fits, starts what overflows).
    resetView: () => goToTarget(0, { behavior: 'instant' }),
  };
  return api;
}
