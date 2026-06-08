/**
 * Stage / PageView / RenderLayer + facade hooks.
 *
 * <Stage> virtualizes and positions page surfaces by the camera, and hands each
 * one to YOUR render prop — you bring the layers. <PageView> is the same surface
 * standalone (no Stage). RenderLayer is the only layer that needs the engine.
 */
import * as React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { StageToken } from '@embedpdf-x/plugin-stage';
import type { VisiblePage } from '@embedpdf-x/plugin-stage';
import type { Camera } from '@embedpdf-x/stage-core';
import {
  DocumentScope,
  makePageContext,
  PageProvider,
  useActiveDocumentId,
  useCapability,
  useDocumentId,
  useKernel,
  useSelector,
} from './runtime';
import type { PageContextValue } from './runtime';

function PageSurface({
  documentId,
  page,
  camera,
  render,
}: {
  documentId: string;
  page: VisiblePage;
  camera: Camera;
  render: (page: PageContextValue) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const zoom = camera.zoom;
  const w = page.width * zoom;
  const h = page.height * zoom;
  const left = (page.x - camera.x) * zoom;
  const top = (page.y - camera.y) * zoom;
  // Render/coordinate scale is device-px per PDF point = the page's content scale
  // (world ÷ intrinsic, from the sizing policy) times the camera zoom.
  const renderScale = page.contentScale * zoom;
  const ctx = useMemo(
    () =>
      makePageContext(
        documentId,
        page.pon,
        page.pageIndex,
        renderScale,
        { width: w, height: h },
        () => ref.current!.getBoundingClientRect(),
      ),
    [documentId, page.pon, page.pageIndex, w, h, renderScale],
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
  const docId = useDocumentId();
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
        <PageSurface
          key={p.pageIndex}
          documentId={docId ?? ''}
          page={p}
          camera={camera}
          render={children}
        />
      ))}
      {overlay}
    </div>
  );
}

export interface PageViewProps {
  page: number;
  /** Which document to show. Defaults to the active document. */
  documentId?: string;
  width?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

/** A single page surface with NO Stage — same layers, no camera/scroll/zoom. */
export function PageView({ page, documentId, width = 240, children, style }: PageViewProps) {
  const kernel = useKernel();
  const active = useActiveDocumentId();
  const ref = useRef<HTMLDivElement>(null);
  const docId = documentId ?? active;
  const meta = docId ? kernel.getState().core.documents[docId] : undefined;
  const base = meta?.pages[page];
  const pon = base?.pageObjectNumber ?? page + 1;
  const scale = base ? width / base.width : 1;
  const w = base ? base.width * scale : 0;
  const h = base ? base.height * scale : 0;
  const ctx = useMemo(
    () =>
      makePageContext(docId ?? '', pon, page, scale, { width: w, height: h }, () =>
        ref.current!.getBoundingClientRect(),
      ),
    [docId, pon, page, w, h, scale],
  );
  if (!docId || !meta) return null;
  return (
    <DocumentScope id={docId}>
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
    </DocumentScope>
  );
}

// ── Facade hooks — thin sugar over the capability + generic binding ───────────
export function useStage() {
  return useCapability(StageToken);
}
export function useZoom() {
  const s = useCapability(StageToken);
  const zoom = useSelector(StageToken, (c) => c.zoomLevel());
  const mode = useSelector(StageToken, (c) => c.zoomMode());
  return {
    zoom,
    /** Active zoom intent: 'automatic' | 'fit-page' | 'fit-width' | 'custom'. */
    mode,
    zoomIn: s.zoomIn,
    zoomOut: s.zoomOut,
    fitWidth: s.fitWidth,
    fitPage: s.fitPage,
    automatic: s.automatic,
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
  const spread = useSelector(StageToken, (c) => c.spread());
  const sizing = useSelector(StageToken, (c) => c.sizing());
  const bounded = useSelector(StageToken, (c) => c.bounded());
  return {
    layout,
    spread,
    sizing,
    bounded,
    setLayout: s.setLayout,
    setSpread: s.setSpread,
    setSizing: s.setSizing,
    setBounded: s.setBounded,
  };
}

/**
 * All Stage settings + the batch `update`. This is the seam for "presets are a
 * customer concern": keep your own `Partial<StageSettings>` objects and apply them
 * with `update(preset)` (one anchor-preserving change).
 */
export function useStageSettings() {
  const s = useCapability(StageToken);
  const settings = useSelector(
    StageToken,
    (c) => c.settings(),
    (a, b) =>
      a.layout === b.layout &&
      a.spread === b.spread &&
      a.bounded === b.bounded &&
      a.overscroll === b.overscroll &&
      a.home === b.home &&
      a.margin === b.margin &&
      a.scrollBehavior === b.scrollBehavior &&
      a.zoom === b.zoom,
  );
  return { settings, update: s.update, reset: s.resetView };
}
