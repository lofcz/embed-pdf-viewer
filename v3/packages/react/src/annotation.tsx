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
import { useEffect, useState } from 'react';
import { AnnotationToken, refKey } from '@embedpdf-x/plugin-annotation';
import {
  scene,
  type Border,
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
  const { left, top, width, height } = boxOf(item.box, page);
  const vb = `${item.box.x} ${item.box.y} ${Math.max(1e-3, item.box.width)} ${Math.max(1e-3, item.box.height)}`;
  return (
    <svg
      viewBox={vb}
      style={{
        position: 'absolute',
        left,
        top,
        width: Math.max(1, width),
        height: Math.max(1, height),
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

function BakedImage({ box, url, page }: { box: Rect; url: string; page: PageContextValue }) {
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
      }}
    />
  );
}

function Chrome({ page }: { page: PageContextValue }) {
  const nodes = useSelector(AnnotationToken, (c) => c.chrome(page.pon), shallowArray);
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

export function AnnotationLayer({ customRenderer }: AnnotationLayerProps = {}) {
  const page = usePage();
  const anno = useCapability(AnnotationToken);
  const items = useSelector(AnnotationToken, (c) => c.pageItems(page.pon), shallowArray);
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
          const baked = urls[item.id];
          native = baked ? <BakedImage box={baked.box} url={baked.url} page={page} /> : null;
        } else {
          native = <Shape item={item} page={page} />; // shapes, cloudy, markup — all painted via scene()
        }
        const out = customRenderer?.({ annotation: item, nativeComponent: native }) ?? native;
        return <React.Fragment key={item.id}>{out}</React.Fragment>;
      })}
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

export function useAnnotationSelectedItems() {
  return useSelector(AnnotationToken, (c) => c.selectedItems(), shallowArray);
}

/** Structural equality for a tool's resolved defaults (style + endings) — keeps the
 *  subscription from re-rendering on unrelated dispatches, since `currentDefaults`
 *  returns a fresh object each call. */
function sameDefaults(a: ToolDefaultsResolved, b: ToolDefaultsResolved): boolean {
  const x = a.style;
  const y = b.style;
  return (
    x.strokeColor === y.strokeColor &&
    x.fillColor === y.fillColor &&
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
