import {
  geomHandles,
  geomHit,
  obbFromGeom,
  placeRotateKnob,
  pointInQuad,
  rectHandlesFor,
  selectionCenter,
  selectionQuad,
  unionRect,
  ROTATE_KNOB_OFFSET,
} from './geometry';
import { capsFor, isMarkup } from './kinds';
import { groupCaps } from './group';
import { type Annot, type Cursor, type Id, type Model, type Rect, type Vec } from './types';

export type Target =
  | { t: 'handle'; id: Id; handle: string; cursor: Cursor }
  // The rotate knob of the current selection (single shape or multi-target
  // group). `pivot` is the rotation centre the gesture turns about.
  | { t: 'rotate'; ids: Id[]; pivot: Vec }
  // A resize handle of the multi-target group box (the union box of the
  // selection). `box` is that union box; `ids` the members it scales.
  | { t: 'group-handle'; ids: Id[]; handle: string; cursor: Cursor; box: Rect }
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

// `opaqueBody` kinds (stamp images) are visible across their whole box, so they
// hit like a filled shape. NOT keyed on `source: 'baked'` — every annotation
// loaded from a PDF starts baked, and an unfilled square must still be grabbed
// only on its outline.
const isFilled = (a: Annot): boolean =>
  a.style.interiorColor != null || a.geom.t === 'quads' || capsFor(a.subtype).opaqueBody;
const inRect = (b: Rect, p: Vec): boolean =>
  p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
// A SELECTED annotation is grabbable from anywhere inside its SELECTION region — the
// SAME oriented quad the chrome outlines — so the grab area matches what you see
// highlighted, tilt included (a rotated box is grabbable across its tilted body, not
// just its unrotated footprint; a thin arrow's whole outline box, arrowhead and all).
const inBounds = (a: Annot, p: Vec): boolean =>
  pointInQuad(p, selectionQuad(a.geom, a.style.strokeWidth, a.style.border));

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
  const corners: Vec[] = [];
  for (const id of sel) {
    const a = m.byId[id];
    corners.push(...selectionQuad(a.geom, a.style.strokeWidth, a.style.border));
  }
  return unionRect(corners);
}

/** The axis-aligned union of the SELECTION bounds of every selected annotation on
 *  a page (no movable/lock filter) — the box group chrome + group rotate use. */
export function groupUnionBounds(m: Model, pon: number): Rect | null {
  const corners: Vec[] = [];
  for (const id of m.selected) {
    const a = m.byId[id];
    if (!a || a.pon !== pon) continue;
    corners.push(...selectionQuad(a.geom, a.style.strokeWidth, a.style.border));
  }
  return corners.length ? unionRect(corners) : null;
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
  pageBox?: Rect,
): Target {
  if (m.selected.length === 1 && isSelectable(m, m.selected[0])) {
    const a = m.byId[m.selected[0]];
    if (a.pon === pon) {
      // The rotate knob (checked first — it floats outside the box, clear of the
      // handles). Only for kinds whose `caps.rotatable` is on. `placeRotateKnob`
      // keeps it inside `pageBox` — the SAME placement `chrome` draws.
      if (capsFor(a.subtype).rotatable) {
        const obb = obbFromGeom(a.geom, a.style.strokeWidth, a.style.border);
        if (obb) {
          const knob = placeRotateKnob(obb.corners, ROTATE_KNOB_OFFSET, pageBox);
          if (Math.abs(knob.at.x - p.x) <= handleTol && Math.abs(knob.at.y - p.y) <= handleTol) {
            return {
              t: 'rotate',
              ids: [a.id],
              pivot: selectionCenter(a.geom, a.style.strokeWidth),
            };
          }
        }
      }
      if (hasHandles(a.subtype)) {
        for (const h of geomHandles(a.geom)) {
          if (Math.abs(h.at.x - p.x) <= handleTol && Math.abs(h.at.y - p.y) <= handleTol) {
            return { t: 'handle', id: a.id, handle: h.id, cursor: h.cursor };
          }
        }
      }
    }
  } else if (m.selected.length > 1) {
    // Multi-target group: a rotate knob hanging off the union box, gated by the
    // group caps (every member rotatable + none locked).
    const gc = groupCaps(m, m.selected);
    if (gc.rotatable) {
      const union = groupUnionBounds(m, pon);
      if (union) {
        const corners: [Vec, Vec, Vec, Vec] = [
          { x: union.x, y: union.y },
          { x: union.x + union.width, y: union.y },
          { x: union.x + union.width, y: union.y + union.height },
          { x: union.x, y: union.y + union.height },
        ];
        const knob = placeRotateKnob(corners, ROTATE_KNOB_OFFSET, pageBox);
        if (Math.abs(knob.at.x - p.x) <= handleTol && Math.abs(knob.at.y - p.y) <= handleTol) {
          const pivot = { x: union.x + union.width / 2, y: union.y + union.height / 2 };
          return { t: 'rotate', ids: m.selected.filter((id) => m.byId[id]?.pon === pon), pivot };
        }
      }
    }
    if (gc.resizable) {
      const union = groupUnionBounds(m, pon);
      if (union) {
        for (const h of rectHandlesFor(union)) {
          if (Math.abs(h.at.x - p.x) <= handleTol && Math.abs(h.at.y - p.y) <= handleTol) {
            return {
              t: 'group-handle',
              ids: m.selected.filter((id) => m.byId[id]?.pon === pon),
              handle: h.id,
              cursor: h.cursor,
              box: union,
            };
          }
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
  pageBox?: Rect,
): Cursor | null {
  const t = hitTest(m, pon, p, handleTol, strokeMargin, pageBox);
  if (t.t === 'handle') return t.cursor;
  if (t.t === 'group-handle') return t.cursor;
  if (t.t === 'rotate') return 'grab';
  if (t.t === 'annot') return m.selected.includes(t.id) && canMove(m, t.id) ? 'move' : 'pointer';
  return null;
}
