/**
 * Stage / PageView / RenderLayer + facade hooks.
 *
 * <Stage> virtualizes and positions page surfaces by the camera, and hands each
 * one to YOUR render prop — you bring the layers. <PageView> is the same surface
 * standalone (no Stage). RenderLayer is the only layer that needs the engine.
 */
import * as React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { StageToken, settingsEqual } from '@embedpdf-x/plugin-stage';
import type { StageCapability, VisiblePage } from '@embedpdf-x/plugin-stage';
import type { CapabilityToken } from '@embedpdf-x/kernel';

/** Which stage lens to bind to. Defaults to the main StageToken — pass a custom
 *  token to drive an additional lens (e.g. a wrapped thumbnail sidebar). */
export type StageTokenProp = CapabilityToken<StageCapability>;
import type { Camera } from '@embedpdf-x/stage-core';
import { NO_FRAME, type PageFrame } from '@embedpdf-x/geometry';
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
  frame,
  render,
  chrome,
}: {
  documentId: string;
  page: VisiblePage;
  camera: Camera;
  /** Reserved chrome bands around the page (screen px); the layout reserved the
   *  matching space, so the outer box tiles into it. */
  frame: PageFrame;
  render: (page: PageContextValue) => React.ReactNode;
  chrome?: (page: PageContextValue) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const zoom = camera.zoom;
  // page.width/height are the DISPLAY footprint (already w↔h-swapped for 90/270
  // by the layout). The CONTENT box occupies that footprint on screen.
  const w = page.width * zoom;
  const h = page.height * zoom;
  const rotation = page.rotation;
  const quarter = rotation === 90 || rotation === 270;
  // Un-rotated content footprint on screen: for a quarter-turn the content's
  // width spans the box height and vice-versa.
  const contentW = quarter ? h : w;
  const contentH = quarter ? w : h;
  // The OUTER box = content box + the reserved frame on every side. Chrome paints
  // into it; the content box is inset by the frame. The surface's top-left moves
  // out by the frame so the content box keeps its scene position.
  const left = (page.x - camera.x) * zoom - frame.left;
  const top = (page.y - camera.y) * zoom - frame.top;
  const outerW = w + frame.left + frame.right;
  const outerH = h + frame.top + frame.bottom;
  // Render/coordinate scale is device-px per PDF point = the page's content scale
  // (world ÷ intrinsic, from the sizing policy) times the camera zoom. Isotropic,
  // so rotation doesn't change it.
  const renderScale = page.contentScale * zoom;
  // PageContext lives in UN-rotated content space (size = contentW×contentH, ref
  // on the rotated wrapper): layers position in page coordinates and the wrapper's
  // CSS rotation carries them; toPagePoint inverts the rotation for hit-testing.
  const ctx = useMemo(
    () =>
      makePageContext(
        documentId,
        page.pon,
        page.pageIndex,
        renderScale,
        { width: contentW, height: contentH },
        () => ref.current!.getBoundingClientRect(),
        rotation,
        frame,
      ),
    [documentId, page.pon, page.pageIndex, contentW, contentH, renderScale, rotation, frame],
  );
  return (
    <div style={{ position: 'absolute', left, top, width: outerW, height: outerH }}>
      <PageProvider value={ctx}>
        {/* the page's white background + shadow — axis-aligned at the content box
            (inset by the frame), so the shadow stays put under rotation. */}
        <div
          style={{
            position: 'absolute',
            left: frame.left,
            top: frame.top,
            width: w,
            height: h,
            background: '#fff',
            boxShadow: '0 6px 18px rgba(0,0,0,.18)',
          }}
        />
        {/* page-space content — the ONLY thing the rotation turns. Centered on the
            content box; markers/annotations ride the rotation in page coordinates. */}
        <div
          ref={ref}
          style={{
            position: 'absolute',
            left: frame.left + w / 2,
            top: frame.top + h / 2,
            width: contentW,
            height: contentH,
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          }}
        >
          {render(ctx)}
        </div>
        {/* box-space chrome — labels, selection border, per-page buttons — fills
            the outer box, NEVER rotates. Bands are plain regions: a label is
            `bottom:0; height: frame.bottom`, a button row `top:0; height: frame.top`. */}
        {chrome?.(ctx)}
      </PageProvider>
    </div>
  );
}

export interface StageProps {
  /**
   * PAGE-SPACE content for each visible page (RenderLayer, annotations,
   * markers). Rendered inside the page's content frame, so it ROTATES with the
   * page's display rotation — coordinates are plain PDF points.
   */
  children: (page: PageContextValue) => React.ReactNode;
  /**
   * BOX-SPACE chrome for each visible page (page-number label, selection
   * border, a per-page rotate/delete button). Rendered into the OUTER box
   * (content + reserved `pageFrame`), so it does NOT rotate and the reserved
   * bands are plain regions (`bottom:0; height: page.frame.bottom`). The three
   * coordinate spaces: `children` (page content), `pageChrome` (page box +
   * frame), `overlay` (viewport).
   */
  pageChrome?: (page: PageContextValue) => React.ReactNode;
  /** Viewport-space UI (menus, controls) rendered above the pages. */
  overlay?: React.ReactNode;
  /** The stage lens to drive (default: the main StageToken). */
  token?: StageTokenProp;
  className?: string;
  style?: React.CSSProperties;
}

export function Stage({
  children,
  pageChrome,
  overlay,
  token = StageToken,
  className,
  style,
}: StageProps) {
  const stage = useCapability(token);
  const ref = useRef<HTMLDivElement>(null);
  const docId = useDocumentId();
  const camera = useSelector(token, (c) => c.camera()); // ref changes on camera change
  const pages = useSelector(token, (c) => c.visiblePages()); // memoized -> stable ref
  // Reserved chrome bands (screen px), uniform across pages — the frame the
  // outer box reserves and `pageChrome` paints into.
  const frame = useSelector(
    token,
    (c) => c.pageFrame(),
    (a, b) => a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left,
  );

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
          frame={frame}
          render={children}
          chrome={pageChrome}
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
  /** Target width for the page CONTENT; the display box is the rotated footprint. */
  width?: number;
  /** Reserved chrome bands around the page (screen px) — same model as `<Stage>`. */
  pageFrame?: PageFrame;
  /** Page-space content (rotates with the page). */
  children: React.ReactNode;
  /** Box-space chrome (label, border, …) — never rotated. Mirrors `<Stage pageChrome>`. */
  pageChrome?: React.ReactNode;
  style?: React.CSSProperties;
}

/** A single page surface with NO Stage — same layers + rotation + chrome frame,
 *  no camera/scroll/zoom. */
export function PageView({
  page,
  documentId,
  width = 240,
  pageFrame = NO_FRAME,
  children,
  pageChrome,
  style,
}: PageViewProps) {
  const kernel = useKernel();
  const active = useActiveDocumentId();
  const ref = useRef<HTMLDivElement>(null);
  const docId = documentId ?? active;
  const meta = docId ? kernel.getState().core.documents[docId] : undefined;
  const base = meta?.pages[page];
  const pon = base?.pageObjectNumber ?? page + 1;
  const rotation = base?.rotation ?? 0;
  const quarter = rotation === 90 || rotation === 270;
  const scale = base ? width / base.width : 1;
  // content footprint (screen px); the display box swaps for quarter-turns
  const contentW = base ? base.width * scale : 0;
  const contentH = base ? base.height * scale : 0;
  const w = quarter ? contentH : contentW;
  const h = quarter ? contentW : contentH;
  // outer box = display box + reserved frame on every side
  const outerW = w + pageFrame.left + pageFrame.right;
  const outerH = h + pageFrame.top + pageFrame.bottom;
  const ctx = useMemo(
    () =>
      makePageContext(
        docId ?? '',
        pon,
        page,
        scale,
        { width: contentW, height: contentH },
        () => ref.current!.getBoundingClientRect(),
        rotation,
        pageFrame,
      ),
    [docId, pon, page, contentW, contentH, scale, rotation, pageFrame],
  );
  if (!docId || !meta) return null;
  return (
    <DocumentScope id={docId}>
      <div style={{ position: 'relative', width: outerW, height: outerH, ...style }}>
        <PageProvider value={ctx}>
          <div
            style={{
              position: 'absolute',
              left: pageFrame.left,
              top: pageFrame.top,
              width: w,
              height: h,
              background: '#fff',
              boxShadow: '0 6px 18px rgba(0,0,0,.18)',
            }}
          />
          <div
            ref={ref}
            style={{
              position: 'absolute',
              left: pageFrame.left + w / 2,
              top: pageFrame.top + h / 2,
              width: contentW,
              height: contentH,
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            }}
          >
            {children}
          </div>
          {pageChrome}
        </PageProvider>
      </div>
    </DocumentScope>
  );
}

// ── Facade hooks — thin sugar over the capability + generic binding ───────────
export function useStage(token: StageTokenProp = StageToken) {
  return useCapability(token);
}
export function useZoom(token: StageTokenProp = StageToken) {
  const s = useCapability(token);
  const zoom = useSelector(token, (c) => c.zoomLevel());
  const mode = useSelector(token, (c) => c.zoomMode());
  return {
    zoom,
    /** Active zoom intent: 'automatic' | 'fit-page' | 'fit-width' | 'fit-all' | 'custom'. */
    mode,
    zoomIn: s.zoomIn,
    zoomOut: s.zoomOut,
    fitWidth: s.fitWidth,
    fitPage: s.fitPage,
    fitAll: s.fitAll,
    automatic: s.automatic,
    zoomTo: s.zoomTo,
  };
}
export function usePages(token: StageTokenProp = StageToken) {
  const s = useCapability(token);
  const currentPage = useSelector(token, (c) => c.currentPage());
  const pageCount = useSelector(token, (c) => c.pageCount());
  return {
    currentPage,
    pageCount,
    goToPage: s.goToPage,
    next: s.next,
    prev: s.prev,
    reveal: s.reveal,
  };
}
export function useLayout(token: StageTokenProp = StageToken) {
  const s = useCapability(token);
  const flow = useSelector(token, (c) => c.flow());
  const layout = useSelector(token, (c) => c.layout());
  const spread = useSelector(token, (c) => c.spread());
  const sizing = useSelector(token, (c) => c.sizing());
  const bounded = useSelector(token, (c) => c.bounded());
  return {
    flow,
    layout,
    spread,
    sizing,
    bounded,
    setFlow: s.setFlow,
    setLayout: s.setLayout,
    setSpread: s.setSpread,
    setSizing: s.setSizing,
    setBounded: s.setBounded,
  };
}

/** The document's page list (with PDF labels) + the current item's pages — the
 *  data for page thumbnails / worksheet-style page tabs. */
export function usePageList(token: StageTokenProp = StageToken) {
  const pages = useSelector(
    token,
    (c) => c.pages(),
    (a, b) =>
      a.length === b.length && a.every((p, i) => p.pon === b[i].pon && p.label === b[i].label),
  );
  const current = useSelector(
    token,
    (c) => c.currentItemPages(),
    (a, b) => a.length === b.length && a.every((x, i) => x === b[i]),
  );
  return { pages, currentItemPages: current };
}

/**
 * All Stage settings + the batch `update`. This is the seam for "presets are a
 * customer concern": keep your own `Partial<StageSettings>` objects and apply them
 * with `update(preset)` (one anchor-preserving change).
 */
export function useStageSettings(token: StageTokenProp = StageToken) {
  const s = useCapability(token);
  // settingsEqual derives from the plugin's settings registry — a new setting is
  // covered here automatically, without this package spelling out the shape.
  const settings = useSelector(token, (c) => c.settings(), settingsEqual);
  return { settings, update: s.update, reset: s.resetView };
}
