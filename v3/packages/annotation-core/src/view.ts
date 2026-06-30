/**
 * Pure view selectors. `pageItems` is the per-annotation render list (live gesture
 * applied) for customRenderer wrapping; `chrome` is the selection overlay
 * (handles carry their resize cursor, group box, marquee).
 */
import {
  geomHandles,
  geomRotateAbout,
  geomRotation,
  geomScaleAbout,
  geomTranslate,
  geomVisualBounds,
  groupResizeFactors,
  obbFromGeom,
  rectFromPoints,
  rectHandlesFor,
  rotateKnob,
  selectionBounds,
  selectionQuad,
  shapeRectFor,
  unionRect,
  ROTATE_KNOB_OFFSET,
} from './geometry';
import { groupCaps } from './group';
import { groupUnionBounds, isSelectable, paintOrder } from './hit';
import { capsFor } from './kinds';
import { blendFor } from './scene';
import { calloutBox, defaultsFor } from './update';
import type { ChromeNode, Geom, Id, Model, Rect, RenderItem, Vec } from './types';
import type { CreationDraftAnchor } from './types';

const RAD2DEG = 180 / Math.PI;
const angleAt = (pivot: Vec, p: Vec): number => Math.atan2(p.y - pivot.y, p.x - pivot.x) * RAD2DEG;

const DRAFT_ID = '__draft__';
const PREVIEW_ID = '__markup_preview__';

const polyPreviewPoints = (points: Vec[], cur: Vec): Vec[] => {
  const last = points[points.length - 1];
  return last && (cur.x !== last.x || cur.y !== last.y) ? [...points, cur] : points;
};

function effGeom(m: Model, id: Id): Geom {
  const a = m.byId[id];
  const d = m.draft;
  if (d) {
    if (d.g === 'move' && d.ids.includes(id)) return geomTranslate(a.geom, d.delta);
    if (d.g === 'handle' && d.id === id) return d.cur;
    if (d.g === 'rotate' && d.ids.includes(id)) {
      const delta = angleAt(d.pivot, d.cur) - angleAt(d.pivot, d.start);
      return geomRotateAbout(a.geom, d.pivot, delta);
    }
    if (d.g === 'group' && d.ids.includes(id)) {
      const { sx, sy } = groupResizeFactors(d.base, d.cur);
      return geomScaleAbout(a.geom, d.anchor, sx, sy);
    }
  }
  return a.geom;
}

/** The annotation's AP-raster box with the live move applied, so a baked bitmap
 *  follows a drag. Undefined for non-baked annotations. */
function effApBox(m: Model, id: Id): Rect | undefined {
  const a = m.byId[id];
  if (!a.apBox) return undefined;
  const d = m.draft;
  if (d?.g === 'move' && d.ids.includes(id)) {
    return { ...a.apBox, x: a.apBox.x + d.delta.x, y: a.apBox.y + d.delta.y };
  }
  return a.apBox;
}

/** Render source for one annotation: an in-progress resize renders LIVE (the
 *  baked raster can't stretch), even though the commit hasn't flipped `source`
 *  yet — so the drag is crisp and a no-op grab can revert to baked. */
function effSource(m: Model, id: Id): 'baked' | 'vector' {
  const a = m.byId[id];
  const d = m.draft;
  // A live resize/rotate/group transform must render LIVE — the baked raster
  // can't stretch or tilt — even before the commit flips `source`.
  if (d?.g === 'handle' && d.id === id) return 'vector';
  if ((d?.g === 'rotate' || d?.g === 'group') && d.ids.includes(id)) return 'vector';
  return a.source;
}

/** A free-text box renders as a LIVE element (editable / reflowing) while it's
 *  being edited or while its source is vector (a resize, in-progress or committed);
 *  otherwise it renders as the engine's baked /AP image, exactly like a shape. */
function textIsLive(m: Model, id: Id): boolean {
  return m.editing === id || effSource(m, id) === 'vector';
}

export function pageItems(m: Model, pon: number): RenderItem[] {
  const items: RenderItem[] = [];
  // `paintOrder` puts text-layer markups beneath every other kind (back→front),
  // so a highlight drawn after a circle still paints under it. The SAME order
  // hit-testing uses, so what you click matches what you see.
  for (const id of paintOrder(m, pon)) {
    const a = m.byId[id];
    // Live (editing / resizing) free-text is rendered by the framework as an editable
    // element (see `textBoxes`); a baked, idle box renders as its engine /AP image —
    // the SAME path shapes use. So only skip text while it's live. A callout is the
    // exception: even while live, its leader/arrow/box-border draw via the vector
    // scene (only its TEXT is the DOM element), so it stays in the render list.
    if (a.geom.t === 'text' && !a.geom.callout && textIsLive(m, id)) continue;
    const geom = effGeom(m, id);
    items.push({
      id,
      ref: a.ref,
      subtype: a.subtype,
      geom,
      box: geomVisualBounds(geom, a.style.strokeWidth),
      apBox: effApBox(m, id),
      style: a.style,
      source: effSource(m, id),
      selected: m.selected.includes(id),
      rot: geomRotation(geom),
      blend: blendFor(a.subtype),
    });
  }
  const d = m.draft;
  if (
    (d?.g === 'create-rect' ||
      d?.g === 'create-line' ||
      d?.g === 'create-poly' ||
      d?.g === 'create-ink') &&
    d.pon === pon
  ) {
    // Preview with the tool's RESOLVED defaults (base + per-subtype override), so the
    // ghost is a faithful WYSIWYG of what will commit — not the bare base style. A
    // cloudy rect stores the OUTER box (see `shapeRectFor`), so the cloud grows out
    // from the cursor; a 0-drag draws nothing (skipped, like a solid 0×0).
    const def = defaultsFor(m, d.subtype);
    const dragged = d.g === 'create-rect' ? rectFromPoints(d.from, d.to) : null;
    const geom: Geom | null =
      d.g === 'create-rect'
        ? dragged && (dragged.width > 0 || dragged.height > 0)
          ? { t: 'rect', rect: shapeRectFor(dragged, d.ellipse, def.style), ellipse: d.ellipse }
          : null
        : d.g === 'create-line'
          ? { t: 'line', a: d.from, b: d.to, ends: def.endings }
          : d.g === 'create-poly'
            ? {
                t: 'poly',
                points: polyPreviewPoints(d.points, d.cur),
                closed: d.closed,
                ends: d.closed ? undefined : def.endings,
              }
            : { t: 'ink', strokes: d.strokes };
    if (geom)
      items.push({
        id: DRAFT_ID,
        ref: null,
        subtype: d.subtype,
        geom,
        box: geomVisualBounds(geom, def.style.strokeWidth),
        style: def.style,
        source: 'ghost',
        selected: false,
      });
  }
  // Callout creation ghost: the in-progress leader (tip → cur, then tip → knee →
  // box) and the text-box preview, painted through the SAME vector scene.
  if (d?.g === 'create-callout' && d.pon === pon) {
    const def = defaultsFor(m, d.subtype);
    const ending = def.endings.end !== 'none' ? def.endings.end : 'open-arrow';
    const geom: Geom =
      d.step === 'knee'
        ? { t: 'line', a: d.tip, b: d.cur, ends: { start: ending, end: 'none' } }
        : { t: 'text', rect: calloutBox(d), callout: { tip: d.tip, knee: d.knee, ending } };
    items.push({
      id: DRAFT_ID,
      ref: null,
      subtype: d.subtype,
      geom,
      box: geomVisualBounds(geom, def.style.strokeWidth),
      style: def.style,
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

/** One free-text box, geometry only (the live move/resize gesture applied), with
 *  its edit flag. The framework renders an editable element here; the plugin
 *  layers the DTO-derived text style on top. */
export interface TextBox {
  id: Id;
  box: Rect;
  editing: boolean;
  /** Applied rotation (deg, CW). `box` is the UNROTATED text box; the framework
   *  rotates the editable element about its centre by this. 0/undefined = none. */
  rot?: number;
}

/** The free-text boxes on a page — the text counterpart of `pageItems`. */
export function textBoxes(m: Model, pon: number): TextBox[] {
  const out: TextBox[] = [];
  for (const id of m.order) {
    const a = m.byId[id];
    if (a.pon !== pon || a.geom.t !== 'text') continue;
    if (!textIsLive(m, id)) continue; // baked → rendered as the /AP image instead
    const g = effGeom(m, id);
    if (g.t !== 'text') continue;
    out.push({ id, box: g.rect, editing: m.editing === id, rot: geomRotation(g) });
  }
  return out;
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
      rot: geomRotation(geom),
    });
  }
  return items;
}

const boxCorners = (r: Rect): [Vec, Vec, Vec, Vec] => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x + r.width, y: r.y + r.height },
  { x: r.x, y: r.y + r.height },
];

/**
 * The rotate knob for the current selection on `pon` — the SAME knob `chrome`
 * draws — or null when the selection has none (non-rotatable single, or a group
 * whose caps aren't rotatable). A single shape's knob hangs off its OBB top edge;
 * a group's off the union box. Shared by `chrome` (to draw) and `selectionAnchor`
 * (to push the menu clear of it), so the two can never disagree on where it is.
 */
export function selectionKnob(m: Model, pon: number): { at: Vec; from: Vec } | null {
  const sel = m.selected.filter((id) => isSelectable(m, id) && m.byId[id].pon === pon);
  if (sel.length === 1) {
    const a = m.byId[sel[0]];
    if (!capsFor(a.subtype).rotatable) return null;
    const obb = obbFromGeom(effGeom(m, sel[0]), a.style.strokeWidth);
    return obb ? rotateKnob(obb.corners, ROTATE_KNOB_OFFSET) : null;
  }
  if (sel.length > 1 && groupCaps(m, sel).rotatable) {
    const union = groupUnionBounds(m, pon);
    if (union) return rotateKnob(boxCorners(union), ROTATE_KNOB_OFFSET);
  }
  return null;
}

export function chrome(m: Model, pon: number): ChromeNode[] {
  const nodes: ChromeNode[] = [];
  if (m.draft?.g === 'marquee' && m.draft.pon === pon) {
    nodes.push({ kind: 'marquee', rect: rectFromPoints(m.draft.from, m.draft.to) });
  }
  const sel = m.selected.filter((id) => isSelectable(m, id) && m.byId[id].pon === pon);
  if (sel.length === 1) {
    const a = m.byId[sel[0]];
    const g = effGeom(m, sel[0]);
    const caps = capsFor(a.subtype);
    const rot = geomRotation(g);
    const obb = caps.rotatable ? obbFromGeom(g, a.style.strokeWidth) : null;
    if (obb && rot !== 0) {
      // a tilted shape: draw the oriented box + the rotate knob off its top edge.
      nodes.push({ kind: 'obb', corners: obb.corners, angle: obb.angle });
    } else {
      nodes.push({ kind: 'outline', rect: selectionBounds(g, a.style.strokeWidth) });
    }
    // handles for kinds that resize (box) or vertex-edit; anchored/markup show a
    // bare outline. `geomHandles` already places them on the rotated box.
    if (caps.resizable || caps.vertexEditable) {
      for (const h of geomHandles(g)) nodes.push({ kind: 'handle', at: h.at, cursor: h.cursor });
    }
  } else if (sel.length > 1) {
    const union = groupUnionBounds(m, pon);
    if (union) {
      nodes.push({ kind: 'outline', rect: union });
      const gc = groupCaps(m, sel);
      if (gc.resizable) {
        for (const h of rectHandlesFor(union))
          nodes.push({ kind: 'handle', at: h.at, cursor: h.cursor });
      }
    }
  }
  // The rotate knob (single shape or group) — one source of truth with the menu
  // anchor, so the menu is always pushed clear of exactly this point.
  const knob = selectionKnob(m, pon);
  if (knob) nodes.push({ kind: 'rotate-knob', at: knob.at, from: knob.from });
  return nodes;
}

/** The content-space union of the selectable selected items on `pon`, or null if
 *  the page holds none. This is the SAME box the chrome outline draws, so a
 *  floating menu sits exactly on the selection. */
export function selectionBoundsOnPage(m: Model, pon: number): Rect | null {
  const sel = m.selected.filter((id) => isSelectable(m, id) && m.byId[id].pon === pon);
  if (sel.length === 0) return null;
  // The rotated AABB: the axis-aligned box that encloses the ORIENTED selection
  // quad. For a tilted shape this tracks the live `rot`, so the upright floating
  // menu floats above the whole tilted shape instead of the (fixed) unrotated box.
  const corners = sel.flatMap((id) => selectionQuad(effGeom(m, id), m.byId[id].style.strokeWidth));
  return unionRect(corners);
}

/** The anchor for a selection-aware floating menu: the PRIMARY page (the first
 *  selectable selected id) + the union box of the selection on that page (content
 *  space). Null when nothing selectable is selected. A cross-page selection
 *  anchors to its primary page, so there is exactly one menu. */
export function selectionAnchor(m: Model): { pon: number; bounds: Rect; knob?: Vec } | null {
  const id = m.selected.find((x) => isSelectable(m, x));
  if (id == null) return null;
  const pon = m.byId[id].pon;
  const bounds = selectionBoundsOnPage(m, pon);
  if (!bounds) return null;
  // `bounds` is the plain selection box (the menu stays centred on it). The knob
  // rides ALONGSIDE it so the menu can nudge ONLY the edge it sits on, and only
  // when the handle would otherwise hide under it — never shifting the centre.
  const knob = selectionKnob(m, pon);
  return knob ? { pon, bounds, knob: knob.at } : { pon, bounds };
}

/** Anchor for controls that finish/cancel an active multi-click creation draft.
 *  It is rect-based like selectionAnchor, using the committed vertices only so
 *  the menu remains stable while the hover preview follows the pointer. */
export function creationDraftAnchor(m: Model): CreationDraftAnchor | null {
  const d = m.draft;
  if (d?.g !== 'create-poly') return null;
  if (!d.points.length) return null;
  const minPoints = d.closed ? 3 : 2;
  return {
    kind: 'poly',
    subtype: d.closed ? 'polygon' : 'polyline',
    pon: d.pon,
    bounds: unionRect(d.points),
    pointCount: d.points.length,
    minPoints,
    canFinish: d.points.length >= minPoints,
  };
}
