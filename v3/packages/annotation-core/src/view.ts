/**
 * Pure view selectors. `pageItems` is the per-annotation render list (live gesture
 * applied) for customRenderer wrapping; `chrome` is the selection overlay
 * (handles carry their resize cursor, group box, marquee).
 */
import {
  geomHandles,
  geomTranslate,
  geomVisualBounds,
  rectFromPoints,
  selectionBounds,
  shapeRectFor,
  unionRect,
} from './geometry';
import { isSelectable, paintOrder } from './hit';
import { capsFor } from './kinds';
import { blendFor } from './scene';
import { defaultsFor } from './update';
import type { ChromeNode, Geom, Id, Model, Rect, RenderItem, Vec } from './types';
import type { CreationDraftAnchor } from './types';

const DRAFT_ID = '__draft__';
const PREVIEW_ID = '__markup_preview__';

const rectCorners = (r: Rect): Vec[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y + r.height },
];

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
  return m.draft?.g === 'handle' && m.draft.id === id ? 'vector' : a.source;
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
    // the SAME path shapes use. So only skip text while it's live.
    if (a.geom.t === 'text' && textIsLive(m, id)) continue;
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
    out.push({ id, box: g.rect, editing: m.editing === id });
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
    });
  }
  return items;
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
    nodes.push({ kind: 'outline', rect: selectionBounds(g, a.style.strokeWidth) });
    // handles only for kinds that resize (box) or vertex-edit; anchored/markup show
    // a bare outline.
    const caps = capsFor(a.subtype);
    if (caps.resizable || caps.vertexEditable) {
      for (const h of geomHandles(g)) nodes.push({ kind: 'handle', at: h.at, cursor: h.cursor });
    }
  } else if (sel.length > 1) {
    const corners = sel.flatMap((id) =>
      rectCorners(selectionBounds(effGeom(m, id), m.byId[id].style.strokeWidth)),
    );
    nodes.push({ kind: 'outline', rect: unionRect(corners) });
  }
  return nodes;
}

/** The content-space union of the selectable selected items on `pon`, or null if
 *  the page holds none. This is the SAME box the chrome outline draws, so a
 *  floating menu sits exactly on the selection. */
export function selectionBoundsOnPage(m: Model, pon: number): Rect | null {
  const sel = m.selected.filter((id) => isSelectable(m, id) && m.byId[id].pon === pon);
  if (sel.length === 0) return null;
  if (sel.length === 1) {
    const a = m.byId[sel[0]];
    return selectionBounds(effGeom(m, sel[0]), a.style.strokeWidth);
  }
  const corners = sel.flatMap((id) =>
    rectCorners(selectionBounds(effGeom(m, id), m.byId[id].style.strokeWidth)),
  );
  return unionRect(corners);
}

/** The anchor for a selection-aware floating menu: the PRIMARY page (the first
 *  selectable selected id) + the union box of the selection on that page (content
 *  space). Null when nothing selectable is selected. A cross-page selection
 *  anchors to its primary page, so there is exactly one menu. */
export function selectionAnchor(m: Model): { pon: number; bounds: Rect } | null {
  const id = m.selected.find((x) => isSelectable(m, x));
  if (id == null) return null;
  const pon = m.byId[id].pon;
  const bounds = selectionBoundsOnPage(m, pon);
  return bounds ? { pon, bounds } : null;
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
