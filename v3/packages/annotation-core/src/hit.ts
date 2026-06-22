import { geomBounds, geomHandles, geomHit } from './geometry';
import { capsFor } from './kinds';
import { type Annot, type Cursor, type Id, type Model, type Vec } from './types';

export type Target =
  | { t: 'handle'; id: Id; handle: string; cursor: Cursor }
  | { t: 'annot'; id: Id }
  | { t: 'empty' };

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

const isFilled = (a: Annot): boolean => a.style.fillColor != null || a.geom.t === 'quads';
const inBounds = (a: Annot, p: Vec): boolean => {
  const b = geomBounds(a.geom);
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
};

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
  for (let i = m.order.length - 1; i >= 0; i--) {
    const id = m.order[i];
    const a = m.byId[id];
    if (!a || a.pon !== pon || !isSelectable(m, id)) continue;
    // A SELECTED annotation is sticky-grabbable from anywhere in its bounds, but
    // only if it can actually move; otherwise it's grabbed on its stroke/fill like
    // an unselected one (so a selectable-but-anchored kind still re-selects cleanly).
    const hit =
      m.selected.includes(id) && canMove(m, id)
        ? inBounds(a, p)
        : geomHit(a.geom, p, strokeMargin, isFilled(a), a.style.strokeWidth);
    if (hit) return { t: 'annot', id };
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
