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
import { isSelectable } from './hit';
import { capsFor } from './kinds';
import { defaultsFor } from './update';
import type { ChromeNode, Geom, Id, Model, Rect, RenderItem, Vec } from './types';

const DRAFT_ID = '__draft__';
const PREVIEW_ID = '__markup_preview__';

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
      apBox: effApBox(m, id),
      style: a.style,
      source: effSource(m, id),
      selected: m.selected.includes(id),
    });
  }
  const d = m.draft;
  if (
    (d?.g === 'create-rect' || d?.g === 'create-line' || d?.g === 'create-ink') &&
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
