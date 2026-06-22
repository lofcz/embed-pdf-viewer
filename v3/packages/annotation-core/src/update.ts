/**
 * The pure annotation core: update(model, msg) → [model, effects].
 *
 * Editing is intent-driven (the shell's edit handler sends `editPointer`, the draw
 * handler `createPointer`). Geometry lives in the `Geom` union; all the per-kind
 * math is in geometry.ts. Effects (create/patch/delete) are the only impurities.
 */
import type { AnnotationRef } from '@embedpdf/engine-core/runtime';
import { canMove, hitTest } from './hit';
import {
  geomBounds,
  geomDragHandle,
  geomTranslate,
  rectFromPoints,
  rectsIntersect,
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

export const initialStyle: Style = {
  strokeColor: '#e5484d',
  fillColor: null,
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

const touch = (a: Annot): Annot => (a.source === 'vector' ? a : { ...a, source: 'vector' });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });

export function update(m: Model, msg: Msg): [Model, Effect[]] {
  switch (msg.t) {
    case 'editPointer':
      return editPointer(m, msg.phase, msg.in);
    case 'createPointer':
      return createPointer(m, msg.phase, msg.subtype, msg.in);
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
  }
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
    const inSel = m.selected.includes(hit.id);
    const selected = input.shift
      ? inSel
        ? m.selected.filter((x) => x !== hit.id)
        : [...m.selected, hit.id]
      : inSel
        ? m.selected
        : [hit.id];
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
    const a = touch({ ...m.byId[d.id], geom: d.cur });
    return [{ ...m, byId: { ...m.byId, [d.id]: a }, draft: null }, [{ fx: 'patch', id: d.id }]];
  }
  if (d.g === 'move') {
    if (Math.hypot(d.delta.x, d.delta.y) < 0.01) return [{ ...m, draft: null }, []]; // a click
    const byId = { ...m.byId };
    const fx: Effect[] = [];
    for (const id of d.ids) {
      byId[id] = touch({ ...byId[id], geom: geomTranslate(byId[id].geom, d.delta) });
      fx.push({ fx: 'patch', id });
    }
    return [{ ...m, byId, draft: null }, fx];
  }
  return [{ ...m, draft: null }, []];
}

function createPointer(
  m: Model,
  phase: 'down' | 'move' | 'up',
  subtype: Subtype,
  input: PointerInput,
): [Model, Effect[]] {
  if (phase === 'down') {
    const draft: Draft | null =
      subtype === 'line'
        ? { g: 'create-line', subtype, pon: input.pon, from: input.point, to: input.point }
        : subtype === 'ink'
          ? { g: 'create-ink', subtype, pon: input.pon, strokes: [[input.point]] }
          : subtype === 'square' || subtype === 'circle'
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
  if (d.g === 'create-rect') {
    const rect = rectFromPoints(d.from, d.to);
    if (rect.width >= MIN_DRAG || rect.height >= MIN_DRAG)
      geom = { t: 'rect', rect, ellipse: d.ellipse };
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
    byId[id] = touch({ ...byId[id], style: { ...byId[id].style, ...patch } });
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
    byId[id] = touch({ ...a, geom: { ...g, ends } });
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

/* ── marquee helper kept for the (future) drag-select; exported for tests ─── */
export function annotsInBox(m: Model, pon: number, a: Vec, b: Vec): Id[] {
  const box = rectFromPoints(a, b);
  return m.order.filter(
    (id) => m.byId[id]?.pon === pon && rectsIntersect(geomBounds(m.byId[id].geom), box),
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
  };
}
