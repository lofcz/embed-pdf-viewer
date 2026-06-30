/**
 * The pure annotation core: update(model, msg) → [model, effects].
 *
 * Editing is intent-driven (the shell's edit handler sends `editPointer`, the draw
 * handler `createPointer`). Geometry lives in the `Geom` union; all the per-kind
 * math is in geometry.ts. Effects (create/patch/delete) are the only impurities.
 */
import type { AnnotationRef } from '@embedpdf/engine-core/runtime';
import { expandGroups, groupMembers } from './group';
import { canMove, hitTest, isSelectable } from './hit';
import {
  caretRectFromTextEnd,
  geomDragHandle,
  geomTranslate,
  rectFromPoints,
  rectsIntersect,
  selectionBounds,
  shapeRectFor,
  unionRect,
} from './geometry';
import type {
  Annot,
  Draft,
  Effect,
  Geom,
  Id,
  LineEndings,
  Model,
  Msg,
  PointerInput,
  Quad,
  Rect,
  Style,
  Subtype,
  ToolDefaults,
  Vec,
} from './types';

const MIN_DRAG = 3;
const HANDLE_TOL = 6;
const isPolySubtype = (subtype: Subtype): subtype is 'polygon' | 'polyline' =>
  subtype === 'polygon' || subtype === 'polyline';

export const initialStyle: Style = {
  color: '#e5484d',
  interiorColor: null,
  strokeWidth: 2,
  opacity: 1,
  border: { kind: 'solid' },
};

const NO_ENDINGS: LineEndings = { start: 'none', end: 'none' };

export const initialModel: Model = {
  byId: {},
  order: [],
  selected: [],
  draft: null,
  preview: null,
  seq: 0,
  style: initialStyle,
  defaults: {},
  hitMargin: 6,
  editing: null,
};

/** Resolve a tool's effective defaults: the base `style` + endings, with the
 *  per-subtype override layered on top. */
export function defaultsFor(m: Model, subtype: Subtype): { style: Style; endings: LineEndings } {
  const d = m.defaults[subtype];
  return {
    style: { ...m.style, ...d?.style },
    endings: { ...NO_ENDINGS, ...d?.endings },
  };
}

/** Flip an annotation to live (vector) rendering — we now own its appearance, so
 *  the engine's baked AP is no longer authoritative. Idempotent. */
const toVector = (a: Annot): Annot => (a.source === 'vector' ? a : { ...a, source: 'vector' });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const translateRect = (r: Rect, d: Vec): Rect => ({ ...r, x: r.x + d.x, y: r.y + d.y });
const geomEqual = (a: Geom, b: Geom): boolean => JSON.stringify(a) === JSON.stringify(b);

export function update(m: Model, msg: Msg): [Model, Effect[]] {
  switch (msg.t) {
    case 'editPointer':
      return editPointer(m, msg.phase, msg.in);
    case 'marqueePointer':
      return marqueePointer(m, msg.phase, msg.in);
    case 'createPointer':
      return createPointer(m, msg.phase, msg.subtype, msg.in);
    case 'finishCreationDraft':
      return finishPolyCreate(m);
    case 'createCaret':
      return createCaret(m, msg.pon, msg.rect);
    case 'createMarkup':
      return createMarkup(m, msg.subtype, msg.pon, msg.rects);
    case 'setMarkupPreview':
      return setMarkupPreview(m, msg.subtype, msg.rectsByPage);
    case 'clearMarkupPreview':
      return m.preview ? [{ ...m, preview: null }, []] : [m, []];
    case 'deselect':
      return m.selected.length ? [{ ...m, selected: [] }, []] : [m, []];
    case 'setStyle':
      return setStyle(m, msg.patch);
    case 'setEndings':
      return setEndings(m, msg.patch);
    case 'setDefaults':
      return setDefaults(m, msg.subtype, msg.patch);
    case 'delete':
      return deleteSelection(m);
    case 'cancel':
      return [{ ...m, draft: null }, []];
    case 'loaded':
      return [mergeLoaded(m, msg.annots), []];
    case 'created':
      return [reconcile(m, msg.tempId, msg.id, msg.ref), []];
    case 'createFailed':
      return [removeAnnots(m, [msg.tempId]), []];
    case 'upsert':
      return [upsertAnnots(m, msg.annots), []];
    case 'remove':
      return [removeAnnots(m, msg.ids), []];
    case 'beginTextEdit':
      return m.byId[msg.id]
        ? [{ ...m, editing: msg.id, selected: [msg.id], draft: null }, []]
        : [m, []];
    case 'setText':
      return setText(m, msg.id, msg.text);
    case 'endTextEdit':
      return m.editing ? [{ ...m, editing: null }, []] : [m, []];
  }
}

/** Apply the editor's plain text optimistically. Updates `contents` on the
 *  DTO-backed model and flips the box to `vector` so the live text shows. Emits
 *  NO effect — the plugin owns the (debounced) engine write while you type, so
 *  the model never churns mid-keystroke. */
function setText(m: Model, id: Id, text: string): [Model, Effect[]] {
  const a = m.byId[id];
  if (!a) return [m, []];
  const next = toVector({ ...a, data: a.data ? { ...a.data, contents: text } : a.data });
  return [{ ...m, byId: { ...m.byId, [id]: next } }, []];
}

function editPointer(
  m: Model,
  phase: 'down' | 'move' | 'up',
  input: PointerInput,
): [Model, Effect[]] {
  if (phase === 'down') return editDown(m, input);
  if (phase === 'move') return m.draft ? editMove(m, input) : [m, []];
  return m.draft ? editUp(m) : [m, []];
}

function editDown(m: Model, input: PointerInput): [Model, Effect[]] {
  const hit = hitTest(m, input.pon, input.point, HANDLE_TOL, m.hitMargin);
  if (hit.t === 'handle') {
    const base = m.byId[hit.id].geom;
    return [{ ...m, draft: { g: 'handle', id: hit.id, handle: hit.handle, base, cur: base } }, []];
  }
  if (hit.t === 'annot') {
    // A hit on any member acts on the WHOLE group — select/toggle/drag as a unit.
    const grp = groupMembers(m, hit.id);
    const inSel = m.selected.includes(hit.id);
    const selected = input.shift
      ? inSel
        ? m.selected.filter((x) => !grp.includes(x)) // shift+click a member → drop the group
        : [...m.selected, ...grp.filter((x) => !m.selected.includes(x))]
      : inSel
        ? m.selected
        : grp;
    // Only arm a move gesture if every selected annotation can move; an anchored
    // kind (markup/caret) still selects, it just won't drag.
    const movable = selected.length > 0 && selected.every((id) => canMove(m, id));
    const draft: Draft | null = movable
      ? { g: 'move', ids: selected, start: input.point, delta: { x: 0, y: 0 } }
      : null;
    return [{ ...m, selected, draft }, []];
  }
  return [{ ...m, selected: [] }, []]; // empty (the handler usually pre-empts via 'deselect')
}

function editMove(m: Model, input: PointerInput): [Model, Effect[]] {
  const d = m.draft!;
  if (d.g === 'move') return [{ ...m, draft: { ...d, delta: sub(input.point, d.start) } }, []];
  if (d.g === 'handle')
    return [{ ...m, draft: { ...d, cur: geomDragHandle(d.base, d.handle, input.point) } }, []];
  return [m, []];
}

function editUp(m: Model): [Model, Effect[]] {
  const d = m.draft!;
  if (d.g === 'handle') {
    // A grab that didn't actually resize leaves the appearance untouched → keep
    // it baked, no engine write.
    if (geomEqual(d.base, d.cur)) return [{ ...m, draft: null }, []];
    // A resize changes the appearance: we own it now → live (vector) render.
    const a = toVector({ ...m.byId[d.id], geom: d.cur });
    return [{ ...m, byId: { ...m.byId, [d.id]: a }, draft: null }, [{ fx: 'patch', id: d.id }]];
  }
  if (d.g === 'move') {
    if (Math.hypot(d.delta.x, d.delta.y) < 0.01) return [{ ...m, draft: null }, []]; // a click
    const byId = { ...m.byId };
    const fx: Effect[] = [];
    for (const id of d.ids) {
      const a = byId[id];
      // A move is a rigid translation — the appearance is unchanged, so a baked
      // annotation STAYS baked and its raster box rides along. Source preserved.
      byId[id] = {
        ...a,
        geom: geomTranslate(a.geom, d.delta),
        apBox: a.apBox ? translateRect(a.apBox, d.delta) : undefined,
      };
      fx.push({ fx: 'patch', id });
    }
    return [{ ...m, byId, draft: null }, fx];
  }
  return [{ ...m, draft: null }, []];
}

function marqueePointer(
  m: Model,
  phase: 'down' | 'move' | 'up',
  input: PointerInput,
): [Model, Effect[]] {
  if (phase === 'down') {
    return [
      { ...m, draft: { g: 'marquee', pon: input.pon, from: input.point, to: input.point } },
      [],
    ];
  }
  if (m.draft?.g !== 'marquee') return [m, []];
  if (phase === 'move') {
    return [{ ...m, draft: { ...m.draft, to: input.point } }, []];
  }

  // A marquee that touches one member takes the whole group with it.
  const hits = expandGroups(m, annotsInBox(m, m.draft.pon, m.draft.from, input.point));
  const selected = input.shift ? toggleSelection(m.selected, hits) : hits;
  return [{ ...m, selected, draft: null }, []];
}

function toggleSelection(base: Id[], ids: Id[]): Id[] {
  const next = new Set(base);
  for (const id of ids) {
    if (next.has(id)) next.delete(id);
    else next.add(id);
  }
  return [...next];
}

function createPointer(
  m: Model,
  phase: 'down' | 'move' | 'up',
  subtype: Subtype,
  input: PointerInput,
): [Model, Effect[]] {
  if (phase === 'down') {
    if (isPolySubtype(subtype)) {
      if (input.finish) return finishPolyCreate(m);
      if (
        m.draft?.g === 'create-poly' &&
        m.draft.subtype === subtype &&
        m.draft.pon === input.pon
      ) {
        return [
          {
            ...m,
            draft: { ...m.draft, points: [...m.draft.points, input.point], cur: input.point },
          },
          [],
        ];
      }
      return [
        {
          ...m,
          selected: [],
          draft: {
            g: 'create-poly',
            subtype,
            pon: input.pon,
            points: [input.point],
            cur: input.point,
            closed: subtype === 'polygon',
          },
        },
        [],
      ];
    }
    const draft: Draft | null =
      subtype === 'line'
        ? { g: 'create-line', subtype, pon: input.pon, from: input.point, to: input.point }
        : subtype === 'ink'
          ? { g: 'create-ink', subtype, pon: input.pon, strokes: [[input.point]] }
          : subtype === 'square' || subtype === 'circle' || subtype === 'free-text'
            ? {
                g: 'create-rect',
                subtype,
                pon: input.pon,
                from: input.point,
                to: input.point,
                ellipse: subtype === 'circle',
              }
            : null;
    return draft ? [{ ...m, selected: [], draft }, []] : [m, []];
  }
  if (phase === 'move') {
    if (m.draft?.g === 'create-poly') {
      return [{ ...m, draft: { ...m.draft, cur: input.point } }, []];
    }
    if (m.draft?.g === 'create-rect' || m.draft?.g === 'create-line') {
      return [{ ...m, draft: { ...m.draft, to: input.point } }, []];
    }
    if (m.draft?.g === 'create-ink') {
      // append to the active (last) stroke as the pen moves
      const strokes = m.draft.strokes.slice();
      strokes[strokes.length - 1] = [...strokes[strokes.length - 1], input.point];
      return [{ ...m, draft: { ...m.draft, strokes } }, []];
    }
    return [m, []];
  }
  // up
  const d = m.draft;
  if (d?.g !== 'create-rect' && d?.g !== 'create-line' && d?.g !== 'create-ink') return [m, []];

  const def = defaultsFor(m, d.subtype);
  let geom: Geom | null = null;
  if (d.g === 'create-rect' && d.subtype === 'free-text') {
    // Free-text: a dragged box, or — on a mere click — a sensible default box you
    // can immediately type into. Always created; never a no-op.
    const dragged = rectFromPoints(d.from, d.to);
    const rect =
      dragged.width >= MIN_DRAG || dragged.height >= MIN_DRAG
        ? dragged
        : { x: d.from.x, y: d.from.y, width: 180, height: 40 };
    geom = { t: 'text', rect };
  } else if (d.g === 'create-rect') {
    const dragged = rectFromPoints(d.from, d.to);
    if (dragged.width >= MIN_DRAG || dragged.height >= MIN_DRAG)
      // cloudy stores the OUTER box (dragged + extent) so the dragged box is its inner edge
      geom = { t: 'rect', rect: shapeRectFor(dragged, d.ellipse, def.style), ellipse: d.ellipse };
  } else if (d.g === 'create-line') {
    if (Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y) >= MIN_DRAG)
      geom = { t: 'line', a: d.from, b: d.to, ends: def.endings };
  } else {
    // create-ink: keep it only if the pen actually travelled (not a stray click)
    const b = unionRect(d.strokes.flat());
    if (d.strokes.some((s) => s.length >= 2) && Math.max(b.width, b.height) >= MIN_DRAG)
      geom = { t: 'ink', strokes: d.strokes };
  }
  if (!geom) return [{ ...m, draft: null }, []];

  const id = `tmp:${m.seq + 1}`;
  const annot: Annot = {
    id,
    ref: null,
    pon: d.pon,
    subtype: d.subtype,
    geom,
    style: def.style,
    locked: false,
    source: 'vector',
  };
  return [
    {
      ...m,
      seq: m.seq + 1,
      byId: { ...m.byId, [id]: annot },
      order: [...m.order, id],
      selected: [id],
      draft: null,
      // A freshly drawn free-text box opens straight into edit (type immediately).
      editing: geom.t === 'text' ? id : m.editing,
    },
    [{ fx: 'create', id }],
  ];
}

function finishPolyCreate(m: Model): [Model, Effect[]] {
  const d = m.draft;
  if (d?.g !== 'create-poly') return [m, []];
  const minPoints = d.closed ? 3 : 2;
  if (d.points.length < minPoints) return [{ ...m, draft: null }, []];

  const def = defaultsFor(m, d.subtype);
  const geom: Geom = {
    t: 'poly',
    points: d.points,
    closed: d.closed,
    ends: d.closed ? undefined : def.endings,
  };
  const id = `tmp:${m.seq + 1}`;
  const annot: Annot = {
    id,
    ref: null,
    pon: d.pon,
    subtype: d.subtype,
    geom,
    style: def.style,
    locked: false,
    source: 'vector',
  };
  return [
    {
      ...m,
      seq: m.seq + 1,
      byId: { ...m.byId, [id]: annot },
      order: [...m.order, id],
      selected: [id],
      draft: null,
    },
    [{ fx: 'create', id }],
  ];
}

/** Per-line selection rects → /QuadPoints quads (content space, y-down: UL, UR,
 *  LL, LR). Shared by markup creation and the live preview. */
const rectsToQuads = (rects: Rect[]): Quad[] =>
  rects
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y },
      { x: r.x, y: r.y + r.height },
      { x: r.x + r.width, y: r.y + r.height },
    ]);

/**
 * Build a text-markup annotation from the selection's per-line rects. The new
 * annotation is `vector` (rendered live by the overlay) and selected, mirroring
 * `createPointer`. One call per page the selection spans. Clears any live preview.
 */
function createMarkup(
  m: Model,
  subtype: Subtype,
  pon: Annot['pon'],
  rects: Rect[],
): [Model, Effect[]] {
  const quads = rectsToQuads(rects);
  if (!quads.length) return [m, []];
  const id = `tmp:${m.seq + 1}`;
  const annot: Annot = {
    id,
    ref: null,
    pon,
    subtype,
    geom: { t: 'quads', quads },
    style: defaultsFor(m, subtype).style,
    locked: false,
    source: 'vector',
  };
  return [
    {
      ...m,
      seq: m.seq + 1,
      byId: { ...m.byId, [id]: annot },
      order: [...m.order, id],
      selected: [id],
      draft: null,
      preview: null,
    },
    [{ fx: 'create', id }],
  ];
}

function createCaret(m: Model, pon: Annot['pon'], textEndRect: Rect): [Model, Effect[]] {
  if (textEndRect.width <= 0 || textEndRect.height <= 0) return [m, []];
  const id = `tmp:${m.seq + 1}`;
  const def = defaultsFor(m, 'caret');
  const annot: Annot = {
    id,
    ref: null,
    pon,
    subtype: 'caret',
    geom: { t: 'caret', rect: caretRectFromTextEnd(textEndRect) },
    style: def.style,
    locked: false,
    source: 'vector',
  };
  return [
    {
      ...m,
      seq: m.seq + 1,
      byId: { ...m.byId, [id]: annot },
      order: [...m.order, id],
      selected: [id],
      draft: null,
      preview: null,
    },
    [{ fx: 'create', id }],
  ];
}

/** Set / replace the live markup preview from the selection's per-page rects. */
function setMarkupPreview(
  m: Model,
  subtype: Subtype,
  rectsByPage: Record<number, Rect[]>,
): [Model, Effect[]] {
  const byPage: Record<number, Quad[]> = {};
  for (const k in rectsByPage) {
    const quads = rectsToQuads(rectsByPage[k]);
    if (quads.length) byPage[Number(k)] = quads;
  }
  return [{ ...m, preview: { subtype, byPage } }, []];
}

function setStyle(m: Model, patch: Partial<Style>): [Model, Effect[]] {
  // No selection → set the base style new annotations inherit (the "current style").
  if (!m.selected.length) return [{ ...m, style: { ...m.style, ...patch } }, []];
  // With a selection → restyle ONLY those annotations. Crucially, leave the base
  // style untouched: editing existing annotations must not change what the next
  // drawn annotation looks like (the base is the fallback under every tool default).
  const byId = { ...m.byId };
  const fx: Effect[] = [];
  for (const id of m.selected) {
    byId[id] = toVector({ ...byId[id], style: { ...byId[id].style, ...patch } });
    fx.push({ fx: 'patch', id });
  }
  return [{ ...m, byId }, fx];
}

function setEndings(m: Model, patch: Partial<LineEndings>): [Model, Effect[]] {
  if (!m.selected.length) return [m, []];
  const byId = { ...m.byId };
  const fx: Effect[] = [];
  for (const id of m.selected) {
    const a = byId[id];
    const g = a?.geom;
    if (!g || (g.t !== 'line' && g.t !== 'poly')) continue;
    if (g.t === 'poly' && g.closed) continue; // polygons carry no /LE endings
    const ends: LineEndings = { ...(g.ends ?? NO_ENDINGS), ...patch };
    byId[id] = toVector({ ...a, geom: { ...g, ends } });
    fx.push({ fx: 'patch', id });
  }
  return [{ ...m, byId }, fx];
}

function setDefaults(m: Model, subtype: Subtype, patch: ToolDefaults): [Model, Effect[]] {
  const prev = m.defaults[subtype] ?? {};
  const next: ToolDefaults = {
    style: { ...prev.style, ...patch.style },
    endings: { ...prev.endings, ...patch.endings },
  };
  return [{ ...m, defaults: { ...m.defaults, [subtype]: next } }, []];
}

function deleteSelection(m: Model): [Model, Effect[]] {
  if (!m.selected.length) return [m, []];
  const fx: Effect[] = [];
  for (const id of m.selected) {
    const ref = m.byId[id]?.ref;
    if (ref) fx.push({ fx: 'delete', ref });
  }
  return [removeAnnots(m, m.selected), fx];
}

/* ── marquee helper; exported for tests ───────────────────────────────────── */
export function annotsInBox(m: Model, pon: number, a: Vec, b: Vec): Id[] {
  const box = rectFromPoints(a, b);
  return m.order.filter(
    (id) =>
      m.byId[id]?.pon === pon &&
      isSelectable(m, id) &&
      rectsIntersect(selectionBounds(m.byId[id].geom, m.byId[id].style.strokeWidth), box),
  );
}

/* ── store maintenance ───────────────────────────────────────────────────── */

function mergeLoaded(m: Model, annots: Annot[]): Model {
  const byId = { ...m.byId };
  const order = [...m.order];
  for (const a of annots) {
    if (byId[a.id]) continue;
    byId[a.id] = a;
    order.push(a.id);
  }
  return { ...m, byId, order };
}

/**
 * Add-or-replace by id. Unlike `mergeLoaded` (which skips ids it already has,
 * for the bulk page read), this OVERWRITES — it's how the data API re-syncs an
 * annotation from the authoritative engine DTO and how a remote edit lands.
 * New ids append to `order`; existing ones keep their position. An annotation
 * currently being dragged (its id is in a `move`/`handle` draft) is left as-is
 * so a remote echo can't yank geometry out from under the local gesture.
 */
function upsertAnnots(m: Model, annots: Annot[]): Model {
  const dragging = draftIds(m.draft);
  const byId = { ...m.byId };
  const order = [...m.order];
  for (const a of annots) {
    if (dragging.has(a.id)) continue;
    if (!byId[a.id]) order.push(a.id);
    byId[a.id] = a;
  }
  return { ...m, byId, order };
}

/** Ids locked by an in-progress local gesture (don't let an upsert clobber them). */
function draftIds(draft: Draft | null): Set<Id> {
  if (!draft) return new Set();
  if (draft.g === 'move') return new Set(draft.ids);
  if (draft.g === 'handle') return new Set([draft.id]);
  return new Set();
}

function removeAnnots(m: Model, ids: Id[]): Model {
  const gone = new Set(ids);
  const byId = { ...m.byId };
  for (const id of ids) delete byId[id];
  return {
    ...m,
    byId,
    order: m.order.filter((id) => !gone.has(id)),
    selected: m.selected.filter((id) => !gone.has(id)),
    draft: null,
    editing: m.editing && gone.has(m.editing) ? null : m.editing,
  };
}

function reconcile(m: Model, tempId: Id, id: Id, ref: AnnotationRef): Model {
  const a = m.byId[tempId];
  if (!a) return m;
  const { [tempId]: _drop, ...rest } = m.byId;
  return {
    ...m,
    byId: { ...rest, [id]: { ...a, id, ref } },
    order: m.order.map((x) => (x === tempId ? id : x)),
    selected: m.selected.map((x) => (x === tempId ? id : x)),
    // keep the just-drawn box in edit mode across the temp→durable id swap
    editing: m.editing === tempId ? id : m.editing,
  };
}
