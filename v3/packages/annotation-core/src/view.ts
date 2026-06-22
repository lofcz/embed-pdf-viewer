/**
 * Pure view selectors. `pageItems` is the per-annotation render list (live gesture
 * applied) for customRenderer wrapping; `chrome` is the selection overlay
 * (handles carry their resize cursor, group box, marquee).
 */
import {
  geomBounds,
  geomHandles,
  geomTranslate,
  geomVisualBounds,
  rectFromPoints,
  unionRect,
} from './geometry';
import { isSelectable } from './hit';
import { capsFor } from './kinds';
import { defaultsFor } from './update';
import type { ChromeNode, Geom, Id, Model, Rect, RenderItem, Vec } from './types';

const DRAFT_ID = '__draft__';
const PREVIEW_ID = '__markup_preview__';

/**
 * The rectangle the SELECTION outline wraps. A line / open polyline wraps its
 * stroke + line endings (the same `geomVisualBounds` the renderer and engine
 * `/Rect` use) so arrowheads sit inside the box. Shapes and closed polygons keep
 * tight bounds, so their 8 resize handles stay exactly on the box corners.
 */
function outlineBounds(g: Geom, strokeWidth: number): Rect {
  return g.t === 'line' || (g.t === 'poly' && !g.closed)
    ? geomVisualBounds(g, strokeWidth)
    : geomBounds(g);
}

const rectCorners = (r: Rect): Vec[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y + r.height },
];

function effGeom(m: Model, id: Id): Geom {
  const a = m.byId[id];
  const d = m.draft;
  if (d) {
    if (d.g === 'move' && d.ids.includes(id)) return geomTranslate(a.geom, d.delta);
    if (d.g === 'handle' && d.id === id) return d.cur;
  }
  return a.geom;
}

export function pageItems(m: Model, pon: number): RenderItem[] {
  const items: RenderItem[] = [];
  for (const id of m.order) {
    const a = m.byId[id];
    if (a.pon !== pon) continue;
    const geom = effGeom(m, id);
    items.push({
      id,
      ref: a.ref,
      subtype: a.subtype,
      geom,
      box: geomVisualBounds(geom, a.style.strokeWidth),
      style: a.style,
      source: a.source,
      selected: m.selected.includes(id),
    });
  }
  const d = m.draft;
  if ((d?.g === 'create-rect' || d?.g === 'create-line') && d.pon === pon) {
    const geom: Geom =
      d.g === 'create-rect'
        ? { t: 'rect', rect: rectFromPoints(d.from, d.to), ellipse: d.ellipse }
        : { t: 'line', a: d.from, b: d.to };
    items.push({
      id: DRAFT_ID,
      ref: null,
      subtype: d.subtype,
      geom,
      box: geomVisualBounds(geom, m.style.strokeWidth),
      style: m.style,
      source: 'ghost',
      selected: false,
    });
  }
  // Live text-markup preview: the in-progress selection rendered as the markup it
  // will become (same `scene()` paint as the committed annotation).
  const quads = m.preview?.byPage[pon];
  if (m.preview && quads?.length) {
    const geom: Geom = { t: 'quads', quads };
    items.push({
      id: PREVIEW_ID,
      ref: null,
      subtype: m.preview.subtype,
      geom,
      box: geomVisualBounds(geom, 0),
      style: defaultsFor(m, m.preview.subtype).style,
      source: 'ghost',
      selected: false,
    });
  }
  return items;
}

/** The currently selected annotations as render items (live gesture applied) —
 *  cross-page, for selection-aware toolbars (style + line-ending editing). */
export function selectedItems(m: Model): RenderItem[] {
  const items: RenderItem[] = [];
  for (const id of m.selected) {
    const a = m.byId[id];
    if (!a) continue;
    const geom = effGeom(m, id);
    items.push({
      id,
      ref: a.ref,
      subtype: a.subtype,
      geom,
      box: geomVisualBounds(geom, a.style.strokeWidth),
      style: a.style,
      source: a.source,
      selected: true,
    });
  }
  return items;
}

export function chrome(m: Model, pon: number): ChromeNode[] {
  const nodes: ChromeNode[] = [];
  const sel = m.selected.filter((id) => isSelectable(m, id) && m.byId[id].pon === pon);
  if (sel.length === 1) {
    const a = m.byId[sel[0]];
    const g = effGeom(m, sel[0]);
    nodes.push({ kind: 'outline', rect: outlineBounds(g, a.style.strokeWidth) });
    // handles only for kinds that resize (box) or vertex-edit; anchored/markup show
    // a bare outline.
    const caps = capsFor(a.subtype);
    if (caps.resizable || caps.vertexEditable) {
      for (const h of geomHandles(g)) nodes.push({ kind: 'handle', at: h.at, cursor: h.cursor });
    }
  } else if (sel.length > 1) {
    const corners = sel.flatMap((id) =>
      rectCorners(outlineBounds(effGeom(m, id), m.byId[id].style.strokeWidth)),
    );
    nodes.push({ kind: 'outline', rect: unionRect(corners) });
  }
  return nodes;
}
