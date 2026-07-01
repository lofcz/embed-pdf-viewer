/**
 * `scene(item)` — the render contract. Turns an annotation render-item into a flat
 * list of fully-PAINTED nodes (geometry + how to paint it). A framework renderer
 * just maps each node to one element and applies `paint`; it owns no per-kind
 * appearance logic, so adding a framework (or a kind) never duplicates drawing.
 *
 * Geometry comes from `geomScene` (shared with hit-testing); paint is layered on
 * here. Text markup is the one family whose paint varies per node (highlight FILLS,
 * underline/strikeout/squiggly STROKE, widths derived from the line height), so it
 * has its own small painter — but it still emits the same generic SceneNodes.
 */
import { geomScene } from './geometry';
import type { Paint, Quad, RenderItem, SceneNode, Style, Subtype } from './types';

const num = (n: number): number => Number(n.toFixed(3));

/** Uniform paint for a shape/line/poly node. Fill only lands on closed nodes; the
 *  dash comes solely from the border style — so a live draft (ghost) previews
 *  exactly how the committed annotation will look, not as a dashed hint. */
/** The CSS mix-blend-mode an annotation composites with against the page. Only
 *  highlights multiply (so the underlying text reads through); every other kind
 *  composites normally. The ONE source of truth, used by the vector painter (per
 *  scene node) AND for the baked /AP image. */
export function blendFor(subtype: Subtype): 'multiply' | undefined {
  return subtype === 'highlight' ? 'multiply' : undefined;
}

function shapePaint(style: Style, closed: boolean): Paint {
  return {
    fill: closed ? (style.interiorColor ?? undefined) : undefined,
    stroke: style.color,
    width: style.strokeWidth,
    opacity: style.opacity,
    dash: style.border.kind === 'dashed' ? style.border.dash : undefined,
  };
}

/** A smooth squiggle (quadratic-bezier wave) along a baseline, adapted from v2's
 *  tile: one `Q` hump then reflected `T` segments alternate up/down across the run. */
function squigglePath(x: number, y: number, w: number, amp: number): string {
  const half = Math.max(2, amp * 1.5); // half a wavelength
  let d = `M ${num(x)} ${num(y)} Q ${num(x + half / 2)} ${num(y - amp)} ${num(x + half)} ${num(y)}`;
  for (let px = x + half; px + half <= x + w + 0.5; px += half) {
    d += ` T ${num(px + half)} ${num(y)}`;
  }
  return d;
}

/** Per-subtype markup nodes. Quads are axis-aligned per-line rects (UL,UR,LL,LR);
 *  the colour is the markup `/C` (our model keeps stroke==fill). */
function markupScene(subtype: Subtype, quads: Quad[], style: Style): SceneNode[] {
  const color = style.color;
  const opacity = style.opacity;
  const nodes: SceneNode[] = [];
  for (const q of quads) {
    const x = q[0].x;
    const y = q[0].y;
    const w = q[1].x - q[0].x;
    const h = q[2].y - q[0].y;
    if (w <= 0 || h <= 0) continue;
    const lw = Math.min(2.5, Math.max(0.75, h * 0.06));
    if (subtype === 'underline') {
      const yy = y + h - lw;
      nodes.push({
        kind: 'line',
        a: { x, y: yy },
        b: { x: x + w, y: yy },
        paint: { stroke: color, width: lw, opacity },
      });
    } else if (subtype === 'strikeout') {
      const yy = y + h / 2;
      nodes.push({
        kind: 'line',
        a: { x, y: yy },
        b: { x: x + w, y: yy },
        paint: { stroke: color, width: lw, opacity },
      });
    } else if (subtype === 'squiggly') {
      const amp = Math.min(2, Math.max(1, h * 0.08));
      nodes.push({
        kind: 'path',
        d: squigglePath(x, y + h - amp, w, amp),
        paint: { stroke: color, width: lw, opacity },
      });
    } else {
      // highlight: translucent fill with `multiply` so the text reads through it
      nodes.push({
        kind: 'rect',
        rect: { x, y, width: w, height: h },
        paint: { fill: color, opacity, blend: blendFor(subtype) },
      });
    }
  }
  return nodes;
}

/** The full painted scene for one annotation. */
export function scene(item: RenderItem): SceneNode[] {
  if (item.geom.t === 'quads') return markupScene(item.subtype, item.geom.quads, item.style);
  if (item.geom.t === 'caret') {
    return geomScene(item.geom).map((n) => ({
      ...n,
      paint: {
        fill: item.style.color,
        stroke: item.style.color,
        width: 0.5,
        opacity: item.style.opacity,
      },
    })) as SceneNode[];
  }
  const ink = item.geom.t === 'ink'; // freehand: round the pen-stroke ends (caps)
  return geomScene(item.geom, item.style.strokeWidth, item.style.border).map((n) => {
    const closed =
      n.kind === 'rect' ||
      n.kind === 'ellipse' ||
      n.kind === 'path' ||
      (n.kind === 'poly' && n.closed);
    const paint = shapePaint(item.style, closed);
    // Ink is freehand: round the pen-stroke ends AND joins. Every other kind keeps
    // the default butt caps + sharp (miter) joins — square corners and poly knees
    // stay crisp.
    return { ...n, paint: ink ? { ...paint, cap: 'round', join: 'round' } : paint } as SceneNode;
  });
}
