/**
 * Stage / PageView / RenderLayer + facade hooks.
 *
 * <Stage> virtualizes and positions page surfaces by the camera, and hands each
 * one to YOUR render prop — you bring the layers. <PageView> is the same surface
 * standalone (no Stage). RenderLayer is the only layer that needs the engine.
 */
import * as React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { StageToken } from '@embedpdf/stage';
import type { Camera, PageBox } from '@embedpdf/stage-core';
import {
  makePageContext,
  PageProvider,
  useCapability,
  useKernel,
  usePage,
  useSelector,
} from './runtime';
import type { PageContextValue } from './runtime';

function PageSurface({
  page,
  camera,
  render,
}: {
  page: PageBox;
  camera: Camera;
  render: (page: PageContextValue) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const zoom = camera.zoom;
  const w = page.width * zoom;
  const h = page.height * zoom;
  const left = (page.x - camera.x) * zoom;
  const top = (page.y - camera.y) * zoom;
  const ctx = useMemo(
    () =>
      makePageContext('doc', page.pageIndex, zoom, { width: w, height: h }, () =>
        ref.current!.getBoundingClientRect(),
      ),
    [page.pageIndex, w, h, zoom],
  );
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left,
        top,
        width: w,
        height: h,
        background: '#fff',
        boxShadow: '0 6px 18px rgba(0,0,0,.18)',
      }}
    >
      <PageProvider value={ctx}>{render(ctx)}</PageProvider>
    </div>
  );
}

export interface StageProps {
  /** Render prop: you decide what each visible page contains. */
  children: (page: PageContextValue) => React.ReactNode;
  /** Viewport-space UI (menus, controls) rendered above the pages. */
  overlay?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Stage({ children, overlay, className, style }: StageProps) {
  const stage = useCapability(StageToken);
  const ref = useRef<HTMLDivElement>(null);
  const camera = useSelector(StageToken, (c) => c.camera()); // ref changes on camera change
  const pages = useSelector(StageToken, (c) => c.visiblePages()); // memoized -> stable ref

  useEffect(() => {
    const el = ref.current!;
    // Only report the viewport size. Initial placement (home) is the Stage plugin's
    // job — it watches the viewport and homes once it's ready (and a persist plugin
    // can override that). The shell stays dumb.
    const setVp = () => stage.setViewport({ width: el.clientWidth, height: el.clientHeight });
    const ro = new ResizeObserver(setVp);
    ro.observe(el);
    setVp();

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        stage.zoomAround(
          { x: e.clientX - r.left, y: e.clientY - r.top },
          Math.exp(-e.deltaY * 0.0015),
        );
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? e.deltaX : e.deltaY;
        stage.panBy(-dx, -dy);
      }
    };
    let dragging = false;
    let lx = 0;
    let ly = 0;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      stage.panBy(e.clientX - lx, e.clientY - ly);
      lx = e.clientX;
      ly = e.clientY;
    };
    const up = () => {
      dragging = false;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [stage]);

  return (
    <div
      ref={ref}
      className={className}
      style={{ position: 'relative', overflow: 'hidden', touchAction: 'none', ...style }}
    >
      {pages.map((p) => (
        <PageSurface key={p.pageIndex} page={p} camera={camera} render={children} />
      ))}
      {overlay}
    </div>
  );
}

export interface PageViewProps {
  page: number;
  width?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

/** A single page surface with NO Stage — same layers, no camera/scroll/zoom. */
export function PageView({ page, width = 240, children, style }: PageViewProps) {
  const kernel = useKernel();
  const ref = useRef<HTMLDivElement>(null);
  const doc = kernel.getState().core.document!;
  const base = doc.pages[page];
  const scale = width / base.width;
  const w = base.width * scale;
  const h = base.height * scale;
  const ctx = useMemo(
    () =>
      makePageContext(doc.id, page, scale, { width: w, height: h }, () =>
        ref.current!.getBoundingClientRect(),
      ),
    [doc.id, page, w, h, scale],
  );
  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        width: w,
        height: h,
        background: '#fff',
        boxShadow: '0 6px 18px rgba(0,0,0,.18)',
        ...style,
      }}
    >
      <PageProvider value={ctx}>{children}</PageProvider>
    </div>
  );
}

/** The only layer that touches the engine. Re-rasterizes on size/page change. */
export function RenderLayer() {
  const page = usePage();
  const kernel = useKernel();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    // ask the engine for RGBA pixels at the display resolution, then paint them
    const res = kernel.engine.renderPage(page.pageIndex, page.scale * dpr);
    c.width = res.width;
    c.height = res.height;
    const img = new ImageData(res.width, res.height);
    img.data.set(res.data);
    c.getContext('2d')!.putImageData(img, 0, 0);
  }, [page.pageIndex, page.size.width, page.size.height, page.scale, kernel]);
  return (
    <canvas
      ref={ref}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}

// ── Facade hooks — thin sugar over the capability + generic binding ───────────
export function useStage() {
  return useCapability(StageToken);
}
export function useZoom() {
  const s = useCapability(StageToken);
  const zoom = useSelector(StageToken, (c) => c.zoomLevel());
  return {
    zoom,
    zoomIn: s.zoomIn,
    zoomOut: s.zoomOut,
    fitWidth: s.fitWidth,
    fitPage: s.fitPage,
    zoomTo: s.zoomTo,
  };
}
export function usePages() {
  const s = useCapability(StageToken);
  const currentPage = useSelector(StageToken, (c) => c.currentPage());
  const pageCount = useSelector(StageToken, (c) => c.pageCount());
  return { currentPage, pageCount, goToPage: s.goToPage };
}
export function useLayout() {
  const s = useCapability(StageToken);
  const layout = useSelector(StageToken, (c) => c.layout());
  const framing = useSelector(StageToken, (c) => c.framing());
  const spread = useSelector(StageToken, (c) => c.spread());
  return {
    layout,
    framing,
    spread,
    setLayout: s.setLayout,
    setFraming: s.setFraming,
    setSpread: s.setSpread,
  };
}
