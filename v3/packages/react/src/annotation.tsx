/**
 * The React view of @embedpdf-x/plugin-annotation.
 *
 * Pure paint: it reads the per-page render items + chrome and draws them. Pointer
 * events arrive through the interaction hub (the Stage's forwarding), and the
 * CURSOR is driven by the hub too (the edit handler claims move/pointer/resize on
 * hover). Each annotation resolves to ONE native node — a vector SceneSvg, the
 * engine's baked /AP <img>, or a registered behavior — and the host
 * `customRenderer` may wrap or replace it.
 */
import * as React from 'react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnnotationToken, refKey, type TextItem } from '@embedpdf-x/plugin-annotation';
// The render layer is framework code, so it resolves the FULL host lens
// (pageItems/chrome/appearances/…). Same runtime token as the public one — only
// the type differs. App code never imports this.
import { AnnotationToken as AnnotationHostToken } from '@embedpdf-x/plugin-annotation/internal';
import {
  scene,
  type Border,
  type CreationDraftAnchor,
  type LineEndings,
  type Paint,
  type Rect,
  type RenderItem,
  type Style,
} from '@embedpdf-x/annotation-core';

/** A tool's resolved defaults, as returned by `currentDefaults`. */
type ToolDefaultsResolved = { style: Style; endings: LineEndings };

export type {
  RenderItem,
  Geom,
  LineEnding,
  LineEndings,
  Border,
  Style,
} from '@embedpdf-x/annotation-core';
import { shallowArray, useCapability, usePage, useSelector } from './runtime';
import type { PageContextValue } from './runtime';
import {
  positionMenuAroundRect,
  type AnnotationMenuPlacement,
  type AnnotationMenuPosition,
} from './annotation-menu-position';

export type { AnnotationMenuPlacement } from './annotation-menu-position';

const ACCENT = '#3858e9';

export interface AnnotationLayerProps {
  customRenderer?: (args: {
    annotation: RenderItem;
    nativeComponent: React.ReactNode;
  }) => React.ReactNode | undefined;
}

/** Content rect → a view-px box (the page wrapper's own coordinate space). */
function boxOf(r: Rect, page: PageContextValue) {
  const tl = page.transform.pageToContent({ x: r.x, y: r.y });
  const br = page.transform.pageToContent({ x: r.x + r.width, y: r.y + r.height });
  return { left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y };
}

/** Map a core `Paint` to SVG presentation attributes — the whole framework-facing
 *  surface. Everything else about appearance is decided in the core's `scene`. */
function paintAttrs(p: Paint) {
  return {
    fill: p.fill ?? 'none',
    stroke: p.stroke ?? 'none',
    strokeWidth: p.width,
    opacity: p.opacity,
    strokeLinejoin: 'round' as const,
    strokeLinecap: p.cap, // undefined → SVG default (butt); 'round' only for ink
    strokeDasharray: p.dash ? p.dash.join(' ') : undefined,
    ...(p.blend ? { style: { mixBlendMode: p.blend } } : {}),
  };
}

/**
 * The dumb painter. The pure core computed `item.box` and the painted `scene`; we
 * size the <svg> to the box with a content-space `viewBox` and map each SceneNode
 * to one element, applying its `paint`. No per-kind logic, no bounds math — so
 * shapes, cloudy borders and every text-markup type all render here, and a Vue /
 * Svelte painter is the same ~10-line loop.
 */
function Shape({ item, page }: { item: RenderItem; page: PageContextValue }) {
  // Nothing to draw until the annotation has area (the 0×0 draft at mouse-down).
  if (item.box.width <= 0 || item.box.height <= 0) return null;
  const { left, top, width, height } = boxOf(item.box, page);
  // The viewBox (content units) and the <svg> on-screen size MUST stay proportional
  // (scale == zoom). Clamping either — e.g. a `max(1px)` floor on the element while
  // the viewBox keeps shrinking — decouples them, so a sub-pixel box scales content
  // up by ~1/size and a cloudy border's scallops flood the stage. No clamps here.
  const vb = `${item.box.x} ${item.box.y} ${item.box.width} ${item.box.height}`;
  return (
    <svg
      viewBox={vb}
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {scene(item).map((n, i) => {
        const a = paintAttrs(n.paint);
        if (n.kind === 'rect')
          return (
            <rect
              key={i}
              x={n.rect.x}
              y={n.rect.y}
              width={n.rect.width}
              height={n.rect.height}
              {...a}
            />
          );
        if (n.kind === 'ellipse')
          return (
            <ellipse
              key={i}
              cx={n.rect.x + n.rect.width / 2}
              cy={n.rect.y + n.rect.height / 2}
              rx={n.rect.width / 2}
              ry={n.rect.height / 2}
              {...a}
            />
          );
        if (n.kind === 'line')
          return <line key={i} x1={n.a.x} y1={n.a.y} x2={n.b.x} y2={n.b.y} {...a} />;
        if (n.kind === 'path') return <path key={i} d={n.d} {...a} />;
        const pts = n.points.map((p) => `${p.x},${p.y}`).join(' ');
        return n.closed ? (
          <polygon key={i} points={pts} {...a} />
        ) : (
          <polyline key={i} points={pts} {...a} />
        );
      })}
    </svg>
  );
}

function BakedImage({
  box,
  url,
  page,
  blend,
}: {
  box: Rect;
  url: string;
  page: PageContextValue;
  blend?: 'multiply';
}) {
  const b = boxOf(box, page);
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        left: b.left,
        top: b.top,
        width: b.width,
        height: b.height,
        pointerEvents: 'none',
        mixBlendMode: blend, // highlights multiply with the page beneath
      }}
    />
  );
}

function Chrome({ page }: { page: PageContextValue }) {
  const nodes = useSelector(AnnotationHostToken, (c) => c.chrome(page.pon), shallowArray);
  return (
    <svg style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
      {nodes.map((n, i) => {
        if (n.kind === 'handle') {
          const p = page.transform.pageToContent(n.at);
          return (
            <rect
              key={i}
              x={p.x - 4}
              y={p.y - 4}
              width={8}
              height={8}
              fill="#fff"
              stroke={ACCENT}
              strokeWidth={1.5}
            />
          );
        }
        const b = boxOf(n.rect, page);
        return (
          <rect
            key={i}
            x={b.left}
            y={b.top}
            width={b.width}
            height={b.height}
            fill={n.kind === 'marquee' ? 'rgba(56,88,233,0.08)' : 'none'}
            stroke={ACCENT}
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        );
      })}
    </svg>
  );
}

/**
 * A free-text annotation: the SAME styled element for viewing and editing —
 * `contentEditable` just toggles, so the text never jumps. The plugin handed us a
 * ready-to-spread style (`item.css`); the browser owns layout, caret, selection,
 * IME and clipboard; the plugin owns the text truth + the debounced engine write.
 * This component is the ENTIRE per-framework surface for text editing.
 */
function FreeText({ item, page }: { item: TextItem; page: PageContextValue }) {
  const anno = useCapability(AnnotationHostToken);
  const ref = React.useRef<HTMLDivElement>(null);
  const box = boxOf(item.box, page);
  const scale = item.box.width > 0 ? box.width / item.box.width : 1; // content units → screen px

  // DOM ← model, but ONLY when this element isn't being typed in — keeps the caret
  // stable while you type AND lets a remote (collab) edit land live when idle.
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerText !== item.contents) {
      el.innerText = item.contents;
    }
  }, [item.contents, item.editing]);
  // Keep DOM focus in sync with the model's `editing` state. Focus follows the
  // model — it never drives it (exit is hub-driven, see the edit handler), so a
  // transient focus-steal by the page surface can't end the edit.
  useEffect(() => {
    if (item.editing) ref.current?.focus();
  }, [item.editing]);

  // Isolate the editor from the interaction hub: a pointerdown inside it must NOT
  // bubble up to the Stage's native listener (which the edit handler reads as a
  // click-outside → exit). Stopping it here lets the browser own caret placement
  // and drag-selection inside the box, while clicks OUTSIDE still reach the hub and
  // commit the edit. Native listener (not React's) so it runs during real DOM
  // bubbling, before the Stage's own native listener on an ancestor.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener('pointerdown', stop);
    return () => el.removeEventListener('pointerdown', stop);
  }, []);

  return (
    <div
      ref={ref}
      contentEditable={item.editing}
      suppressContentEditableWarning
      onInput={() => item.ref && anno.setContents(item.ref, ref.current!.innerText)}
      onBlur={(e) => {
        // The gesture that opens the editor fires a native `mousedown` on the
        // non-focusable page surface, which blurs us to <body> (relatedTarget null)
        // right after we focus. If the MODEL still has this box in edit, that blur
        // is a spurious steal — re-assert focus. A real click-away routes through
        // the hub, which clears `editing` BEFORE this fires, so we let it go (and a
        // focus move to a real element, relatedTarget != null, is always honoured).
        if (
          e.relatedTarget == null &&
          ref.current?.isConnected &&
          anno.currentEditing() === item.id
        ) {
          ref.current.focus();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
      style={{
        position: 'absolute',
        left: box.left,
        top: box.top,
        width: box.width,
        minHeight: box.height,
        fontFamily: item.css.fontFamily,
        fontSize: item.css.fontSize * scale,
        lineHeight: `${item.css.lineHeight * scale}px`,
        color: item.css.color,
        textAlign: item.css.align,
        padding: item.css.padding * scale,
        boxSizing: 'border-box',
        background: item.css.background ?? 'transparent',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        outline: item.editing ? '1px solid #3858e9' : 'none',
        cursor: item.editing ? 'text' : 'default',
        // not editing → clicks fall through to the shape layer (select / move / resize)
        pointerEvents: item.editing ? 'auto' : 'none',
      }}
    />
  );
}

export function AnnotationLayer({ customRenderer }: AnnotationLayerProps = {}) {
  const page = usePage();
  const anno = useCapability(AnnotationHostToken);
  const items = useSelector(AnnotationHostToken, (c) => c.pageItems(page.pon), shallowArray);
  const texts = useSelector(AnnotationHostToken, (c) => c.textItems(page.pon), shallowArray);
  const [urls, setUrls] = useState<Record<string, { url: string; box: Rect }>>({});

  useEffect(() => {
    anno.ensurePage(page.pon);
  }, [anno, page.pon]);

  useEffect(() => {
    const controller = new AbortController();
    const revokers: Array<() => void> = [];
    (async () => {
      try {
        const imgs = await anno.appearances(
          page.pon,
          page.transform.renderScale,
          controller.signal,
        );
        const map: Record<string, { url: string; box: Rect }> = {};
        for (const ap of imgs) {
          // Place the baked bitmap by its OWN /Rect (the box it was rendered into),
          // converted to content space by the plugin — never a recomputed bound.
          const box = anno.toContentBox(page.pon, ap.rect);
          if (!box) continue;
          const obj = await ap.image.objectUrl(controller.signal);
          if (controller.signal.aborted) {
            obj.revoke();
            return;
          }
          revokers.push(obj.revoke);
          map[refKey(ap.ref)] = { url: obj.url, box };
        }
        if (!controller.signal.aborted) setUrls(map);
      } catch {
        /* aborted / no appearances */
      }
    })();
    return () => {
      controller.abort();
      revokers.forEach((r) => r());
    };
  }, [anno, page.pon, page.transform.renderScale]);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {items.map((item) => {
        const behavior = anno.behaviorFor({ subtype: item.subtype, ref: item.ref });
        let native: React.ReactNode = null;
        if (behavior) {
          native = null; // registered per-framework (forms); v1 has none
        } else if (item.source === 'baked') {
          // Blit the engine raster into the annotation's LIVE AP box (`apBox`
          // follows a move), so a dragged baked annotation rides along; fall back
          // to the fetched box for a never-moved one.
          const baked = urls[item.id];
          native = baked ? (
            <BakedImage
              box={item.apBox ?? baked.box}
              url={baked.url}
              page={page}
              blend={item.blend}
            />
          ) : null;
        } else {
          native = <Shape item={item} page={page} />; // shapes, cloudy, markup — all painted via scene()
        }
        const out = customRenderer?.({ annotation: item, nativeComponent: native }) ?? native;
        return <React.Fragment key={item.id}>{out}</React.Fragment>;
      })}
      {texts.map((t) => (
        <FreeText key={t.id} item={t} page={page} />
      ))}
      <Chrome page={page} />
    </div>
  );
}

export function useAnnotation() {
  return useCapability(AnnotationToken);
}

export function useAnnotationSelection() {
  return useSelector(AnnotationToken, (c) => c.selection(), shallowArray);
}

/** The selected annotations as engine DTOs — for selection-aware toolbars/sidebars. */
export function useAnnotationSelected() {
  return useSelector(AnnotationToken, (c) => c.getSelected(), shallowArray);
}

/** Structural equality for a tool's resolved defaults (style + endings) — keeps the
 *  subscription from re-rendering on unrelated dispatches, since `currentDefaults`
 *  returns a fresh object each call. */
function sameDefaults(a: ToolDefaultsResolved, b: ToolDefaultsResolved): boolean {
  const x = a.style;
  const y = b.style;
  return (
    x.color === y.color &&
    x.interiorColor === y.interiorColor &&
    x.strokeWidth === y.strokeWidth &&
    x.opacity === y.opacity &&
    x.border.kind === y.border.kind &&
    (x.border.kind === 'cloudy'
      ? x.border.intensity === (y.border as Extract<Border, { kind: 'cloudy' }>).intensity
      : x.border.kind === 'dashed'
        ? x.border.dash.join() === (y.border as Extract<Border, { kind: 'dashed' }>).dash.join()
        : true) &&
    a.endings.start === b.endings.start &&
    a.endings.end === b.endings.end
  );
}

/**
 * A tool's RESOLVED defaults (base style + per-subtype override), subscribed so a
 * `setDefaults` re-renders the consumer. Use this — not the imperative
 * `useAnnotation().currentDefaults(id)` — to drive default-editing controls, so they
 * reflect changes live.
 */
export function useAnnotationDefaults(toolId: string): ToolDefaultsResolved {
  return useSelector(AnnotationToken, (c) => c.currentDefaults(toolId), sameDefaults);
}

// ── Selection menu ────────────────────────────────────────────────────────────
// A headless, render-prop menu that floats over the current selection. The
// content-space anchor (`selectionAnchor`) is shared by BOTH flavors: the default
// Stage `<AnnotationMenu>` (in `./annotation-menu`, positions via the camera) and
// the Stage-free `<PageAnnotationMenu>` below (positions via `page.toClientRect`).

/** The selection's menu anchor: the primary page + the union box of the selection
 *  on that page (content space). */
export type SelectionAnchor = { pon: number; bounds: Rect };

/** Structural equality for the selection anchor — keeps the menu from re-rendering
 *  on unrelated dispatches (the capability returns a fresh object each call). */
export function sameAnchor(a: SelectionAnchor | null, b: SelectionAnchor | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.pon === b.pon &&
    a.bounds.x === b.bounds.x &&
    a.bounds.y === b.bounds.y &&
    a.bounds.width === b.bounds.width &&
    a.bounds.height === b.bounds.height
  );
}

/** What a menu's render prop receives: the live selection (engine DTOs) + the
 *  selection-scoped intents. Fully headless — you render all UI. */
export interface AnnotationMenuRenderArgs {
  selected: ReturnType<typeof useAnnotationSelected>;
  deleteSelection: () => void;
  deselect: () => void;
  updateSelection: (patch: {
    style?: Partial<Style>;
    endings?: Partial<LineEndings>;
  }) => Promise<void>;
}

export interface AnnotationMenuProps {
  children: (args: AnnotationMenuRenderArgs) => React.ReactNode;
  /** Gap in screen px between the selection box and the menu (default 8). */
  gap?: number;
  /** Where to place the menu relative to the selection box. Default 'top'. */
  placement?: AnnotationMenuPlacement;
}

export function sameCreationDraftAnchor(
  a: CreationDraftAnchor | null,
  b: CreationDraftAnchor | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind &&
    a.subtype === b.subtype &&
    a.pon === b.pon &&
    a.pointCount === b.pointCount &&
    a.minPoints === b.minPoints &&
    a.canFinish === b.canFinish &&
    a.bounds.x === b.bounds.x &&
    a.bounds.y === b.bounds.y &&
    a.bounds.width === b.bounds.width &&
    a.bounds.height === b.bounds.height
  );
}

export interface AnnotationDraftMenuRenderArgs extends CreationDraftAnchor {
  finish: () => void;
  cancel: () => void;
}

export interface AnnotationDraftMenuProps {
  children: (args: AnnotationDraftMenuRenderArgs) => React.ReactNode;
  /** Gap in screen px between the draft anchor and the menu (default 8). */
  gap?: number;
  /** Where to place the menu relative to the draft anchor. Default 'top'. */
  placement?: AnnotationMenuPlacement;
}

/**
 * The Stage-FREE selection menu, for `<PageView>` (no camera). It transforms a
 * selected content rect to client px via `page.toClientRect`, then renders an
 * UPRIGHT menu through a portal to
 * `document.body` (so it never rotates with the page nor clips at a container
 * edge). Re-measures on scroll/resize. For `<Stage>`, prefer `<AnnotationMenu>`
 * from `@embedpdf-x/react/annotation-menu` (camera-driven, more responsive).
 */
export function PageAnnotationMenu({ children, gap = 8, placement = 'top' }: AnnotationMenuProps) {
  const page = usePage();
  const anno = useCapability(AnnotationHostToken);
  const anchor = useSelector(AnnotationHostToken, (c) => c.selectionAnchor(), sameAnchor);
  const selected = useAnnotationSelected();
  const [pos, setPos] = useState<AnnotationMenuPosition | null>(null);
  const here = !!anchor && anchor.pon === page.pon;

  // Measure in a layout effect (NOT during render): `page.toClientRect` reads the
  // page wrapper's live client rect, which only exists after the ref commits.
  useLayoutEffect(() => {
    if (!here || !anchor) {
      setPos(null);
      return;
    }
    const measure = () => {
      setPos(positionMenuAroundRect(page.toClientRect(anchor.bounds), placement, gap));
    };
    measure();
    // No camera here — the page only moves when the document scrolls or resizes.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [here, anchor, page, gap, placement]);

  if (!pos) return null;
  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        transform: pos.transform,
        pointerEvents: 'auto',
      }}
    >
      {children({
        selected,
        deleteSelection: anno.deleteSelection,
        deselect: anno.deselect,
        updateSelection: anno.updateSelection,
      })}
    </div>,
    document.body,
  );
}

export function PageAnnotationDraftMenu({
  children,
  gap = 8,
  placement = 'top',
}: AnnotationDraftMenuProps) {
  const page = usePage();
  const anno = useCapability(AnnotationHostToken);
  const anchor = useSelector(
    AnnotationHostToken,
    (c) => c.creationDraftAnchor(),
    sameCreationDraftAnchor,
  );
  const [pos, setPos] = useState<AnnotationMenuPosition | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);
  const here = !!anchor && anchor.pon === page.pon;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener('pointerdown', stop);
    return () => el.removeEventListener('pointerdown', stop);
  });

  useLayoutEffect(() => {
    if (!here || !anchor) {
      setPos(null);
      return;
    }
    const measure = () => {
      setPos(positionMenuAroundRect(page.toClientRect(anchor.bounds), placement, gap));
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [here, anchor, page, gap, placement]);

  if (!anchor || !pos) return null;
  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        transform: pos.transform,
        pointerEvents: 'auto',
      }}
    >
      {children({
        ...anchor,
        finish: anno.finishCreationDraft,
        cancel: anno.cancelCreationDraft,
      })}
    </div>,
    document.body,
  );
}
