import { geomHandles, geomHit, selectionBounds } from './geometry';
import { capsFor, isMarkup } from './kinds';
import { type Annot, type Cursor, type Id, type Model, type Rect, type Vec } from './types';

export type Target =
  | { t: 'handle'; id: Id; handle: string; cursor: Cursor }
  | { t: 'annot'; id: Id }
  | { t: 'empty' };

/** Page annotation ids in PAINT order (back→front): text-layer markups first
 *  (always beneath), then every other kind, each group preserving creation
 *  z-order. The ONE z-order shared by rendering (`pageItems`) and hit-testing. */
export function paintOrder(m: Model, pon: number): Id[] {
  const markup: Id[] = [];
  const other: Id[] = [];
  for (const id of m.order) {
    const a = m.byId[id];
    if (!a || a.pon !== pon) continue;
    (isMarkup(a.subtype) ? markup : other).push(id);
  }
  return [...markup, ...other];
}

/** Can this annotation be clicked to select? (locked overrides all caps.) */
export const isSelectable = (m: Model, id: Id): boolean => {
  const a = m.byId[id];
  return !!a && !a.locked && capsFor(a.subtype).selectable;
};

/** Can this annotation be dragged by its body to move? */
export const canMove = (m: Model, id: Id): boolean => {
  const a = m.byId[id];
  return !!a && !a.locked && capsFor(a.subtype).movable;
};

/** Does this kind expose drag handles (box resize OR per-vertex)? */
const hasHandles = (subtype: string): boolean => {
  const c = capsFor(subtype);
  return c.resizable || c.vertexEditable;
};

const isFilled = (a: Annot): boolean => a.style.interiorColor != null || a.geom.t === 'quads';
const inRect = (b: Rect, p: Vec): boolean =>
  p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
// A SELECTED annotation is grabbable from anywhere inside its SELECTION region — the
// SAME rect the chrome outlines — so the grab area matches what you see highlighted
// (a thin/horizontal arrow's whole outline box, arrowhead included; not a sliver).
const inBounds = (a: Annot, p: Vec): boolean =>
  inRect(selectionBounds(a.geom, a.style.strokeWidth), p);

/**
 * The union of the SELECTION bounds of every selected, movable annotation on a
 * page — the SAME box `chrome` outlines for a multi-selection. Null unless 2+
 * such annotations are selected here. This is the grab region for the gaps
 * BETWEEN grouped/multi-selected annotations, so dragging the whole selection
 * works from anywhere inside its visible outline (not only on a member).
 */
function selectionUnionBounds(m: Model, pon: number): Rect | null {
  const sel = m.selected.filter(
    (id) => m.byId[id]?.pon === pon && isSelectable(m, id) && canMove(m, id),
  );
  if (sel.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of sel) {
    const a = m.byId[id];
    const b = selectionBounds(a.geom, a.style.strokeWidth);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * What's under the content point.
 *  1. a resize/vertex handle of the single selection,
 *  2. an editable annotation body — a SELECTED one anywhere in its bounds (so you
 *     can drag to move it), an UNSELECTED one only on its stroke/fill (margin-aware,
 *     so an unfilled circle is grabbed only on its outline),
 *  3. else empty.
 */
export function hitTest(
  m: Model,
  pon: number,
  p: Vec,
  handleTol: number,
  strokeMargin: number,
): Target {
  if (m.selected.length === 1 && isSelectable(m, m.selected[0])) {
    const a = m.byId[m.selected[0]];
    if (a.pon === pon && hasHandles(a.subtype)) {
      for (const h of geomHandles(a.geom)) {
        if (Math.abs(h.at.x - p.x) <= handleTol && Math.abs(h.at.y - p.y) <= handleTol) {
          return { t: 'handle', id: a.id, handle: h.id, cursor: h.cursor };
        }
      }
    }
  }
  const order = paintOrder(m, pon);
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const a = m.byId[id];
    if (!a || !isSelectable(m, id)) continue;
    // A SELECTED annotation is sticky-grabbable from anywhere in its bounds, but
    // only if it can actually move; otherwise it's grabbed on its stroke/fill like
    // an unselected one (so a selectable-but-anchored kind still re-selects cleanly).
    const hit =
      m.selected.includes(id) && canMove(m, id)
        ? inBounds(a, p)
        : geomHit(a.geom, p, strokeMargin, isFilled(a), a.style.strokeWidth);
    if (hit) return { t: 'annot', id };
  }
  // Nothing under the point directly — but a multi-selection is grabbable across
  // its WHOLE union box (the gaps between members included), so a drag there moves
  // the group as a unit instead of clearing it. Resolve to the top-most selected
  // member so `editDown` keeps the selection and arms the move.
  const union = selectionUnionBounds(m, pon);
  if (union && inRect(union, p)) {
    for (let i = order.length - 1; i >= 0; i--) {
      if (m.selected.includes(order[i]) && canMove(m, order[i]))
        return { t: 'annot', id: order[i] };
    }
  }
  return { t: 'empty' };
}

/** The cursor to show on hover: a resize cursor over a handle, move/pointer over a body. */
export function cursorAt(
  m: Model,
  pon: number,
  p: Vec,
  handleTol: number,
  strokeMargin: number,
): Cursor | null {
  const t = hitTest(m, pon, p, handleTol, strokeMargin);
  if (t.t === 'handle') return t.cursor;
  if (t.t === 'annot') return m.selected.includes(t.id) && canMove(m, t.id) ? 'move' : 'pointer';
  return null;
}
