/**
 * The pure annotation core: update(model, msg) → [model, effects].
 *
 * Editing is intent-driven (the shell's edit handler sends `editPointer`, the draw
 * handler `createPointer`). Geometry lives in the `Geom` union; all the per-kind
 * math is in geometry.ts. Effects (create/patch/delete) are the only impurities.
 */
import type { AnnotationRef } from '@embedpdf/engine-core/runtime';
import { expandGroups, groupMembers } from './group';
import { canMove, groupUnionBounds, hitTest, isSelectable } from './hit';
import { capsFor } from './kinds';
import {
  caretRectFromTextEnd,
  geomDragHandle,
  geomResetRotation,
  geomRotateAbout,
  geomRotation,
  geomScaleAbout,
  geomTranslate,
  groupResizeAnchor,
  groupResizeBox,
  groupResizeFactors,
  normalizeDeg,
  rectFromPoints,
  rectsIntersect,
  selectionCenter,
  selectionQuad,
  shapeRectFor,
  unionRect,
} from './geometry';
import { applyProps, initialTextStyle, styleFromProps, textStyleFromProps } from './props';
import { computeMoveSnap } from './snap';
import type {
  Annot,
  AnnotationProps,
  AnnotationPropsPatch,
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
  snap: {
    guides: true,
    guideThreshold: 5,
    rotation: true,
    rotationAngles: [0, 90, 180, 270],
    rotationThreshold: 4,
  },
};

/**
 * Resolve a tool's effective defaults as a FULL flat props bag: the base `style`
 * + the font/endings base, with the per-tool override layered on top. This is
 * what a defaults-editing UI reads, and what creation projects `style`/`text`
 * from (`styleFromProps` / `textStyleFromProps`).
 */
export function defaultsFor(m: Model, subtype: Subtype): AnnotationProps {
  const d = m.defaults[subtype];
  return {
    ...m.style,
    ...initialTextStyle,
    ...d,
    lineEndings: { ...NO_ENDINGS, ...d?.lineEndings },
  };
}

/** Flip an annotation to live (vector) rendering — we now own its appearance, so
 *  the engine's baked AP is no longer authoritative. Idempotent. */
const toVector = (a: Annot): Annot => (a.source === 'vector' ? a : { ...a, source: 'vector' });
/**
 * Take ownership of the appearance after a GEOMETRY edit. Vector kinds flip to
 * live rendering; `opaqueBody` kinds (stamp images) have NO vector render — they
 * stay `baked`, with the raster box following the committed geometry (the bitmap
 * shows stretched until the engine's natively re-fit appearance arrives with the
 * DTO sync). Call with the NEW geometry already applied.
 */
const ownGeometry = (a: Annot): Annot => {
  if (!capsFor(a.subtype).opaqueBody) return toVector(a);
  return 'rect' in a.geom ? { ...a, apBox: a.geom.rect } : a;
};
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const translateRect = (r: Rect, d: Vec): Rect => ({ ...r, x: r.x + d.x, y: r.y + d.y });

/* ── page-bound gestures ──────────────────────────────────────────────────────
 * Annotations are page-bound; the pointer isn't. Two rules keep them apart:
 *  1. FRAME: a gesture is anchored to the page it started on. A sample resolved
 *     against another page is in a different coordinate frame (each page's
 *     content space has its own origin) — subtracting across frames produced
 *     the teleport-to-page-top bug, so foreign-page samples are ignored.
 *  2. CLAMP: within the home frame, geometry pins to the page box (v2 rule):
 *     an overshooting pointer slides the shape along the edge; a shape larger
 *     than the page pins to the page's top/left (lo wins when lo > hi).
 */
const clampAxis = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const clampPointToBox = (p: Vec, box: Rect | undefined): Vec =>
  box
    ? {
        x: clampAxis(p.x, box.x, box.x + box.width),
        y: clampAxis(p.y, box.y, box.y + box.height),
      }
    : p;

/** The union of the ids' SELECTION bounds (the outline the user sees) — the box
 *  the page-clamp keeps inside the page during a move. */
function unionBoundsOf(m: Model, ids: Id[]): Rect | null {
  const corners: Vec[] = [];
  for (const id of ids) {
    const a = m.byId[id];
    if (!a) continue;
    corners.push(...selectionQuad(a.geom, a.style.strokeWidth, a.style.border));
  }
  return corners.length ? unionRect(corners) : null;
}

/** Clamp a move delta so the selection's union bounds stay inside the page.
 *  Per-axis, so a pointer past the bottom edge still slides the selection
 *  horizontally along that edge. */
function clampMoveDelta(m: Model, ids: Id[], delta: Vec, page: Rect | undefined): Vec {
  if (!page) return delta;
  const b = unionBoundsOf(m, ids);
  if (!b) return delta;
  return {
    x: clampAxis(delta.x, page.x - b.x, page.x + page.width - (b.x + b.width)),
    y: clampAxis(delta.y, page.y - b.y, page.y + page.height - (b.y + b.height)),
  };
}

/** The page an edit draft is anchored to — every edit gesture lives on ONE page. */
function editDraftPon(m: Model, d: Draft): number | null {
  const id = d.g === 'handle' ? d.id : 'ids' in d && d.ids.length ? d.ids[0] : null;
  return id != null ? (m.byId[id]?.pon ?? null) : null;
}
const geomEqual = (a: Geom, b: Geom): boolean => JSON.stringify(a) === JSON.stringify(b);
const RAD2DEG = 180 / Math.PI;

/** The signed CW angle (deg) of `p` relative to `pivot`, in content space (y-down). */
const angleAt = (pivot: Vec, p: Vec): number => Math.atan2(p.y - pivot.y, p.x - pivot.x) * RAD2DEG;

/** Shortest signed arc from `a` to `b` (deg), in (-180, 180]. */
const arcTo = (a: number, b: number): number => ((b - a + 540) % 360) - 180;

/**
 * The live rotation of a rotate draft, snapping applied — the ONE angle rule
 * shared by the preview (`effGeom`), the commit (`editUp`) and the angle chip,
 * so they can never disagree. The selection's ABSOLUTE angle (a single member's
 * `rot` + the raw pointer delta; a group's raw delta from 0) locks onto the
 * configured angles within the threshold; `free` (shift held) bypasses.
 * `delta` is what `geomRotateAbout` applies; `angle` is what the chip shows.
 */
export function rotateDraftDelta(
  m: Model,
  d: Extract<Draft, { g: 'rotate' }>,
): { delta: number; angle: number; snapped: boolean } {
  const raw = angleAt(d.pivot, d.cur) - angleAt(d.pivot, d.start);
  const one = d.ids.length === 1 ? m.byId[d.ids[0]] : null;
  const base = one ? geomRotation(one.geom) : 0;
  const angle = normalizeDeg(base + raw);
  if (!m.snap.rotation || d.free) return { delta: raw, angle, snapped: false };
  for (const target of m.snap.rotationAngles) {
    const adjust = arcTo(angle, normalizeDeg(target));
    if (Math.abs(adjust) <= m.snap.rotationThreshold)
      return { delta: raw + adjust, angle: normalizeDeg(target), snapped: true };
  }
  return { delta: raw, angle, snapped: false };
}

/** A group resize is isotropic (uniform) when ANY selected member is rotated —
 *  an off-axis scale across a rotated rect+rot is a shear it can't represent. A
 *  vertex member's advisory `rot` counts (preserves obbFromTheta + reset). */
const selectionHasRotation = (m: Model, ids: Id[]): boolean =>
  ids.some((id) => geomRotation(m.byId[id]?.geom ?? ({ t: 'caret' } as Geom)) !== 0);

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
    case 'setProps':
      return setProps(m, msg.patch);
    case 'setDefaults':
      return setDefaults(m, msg.subtype, msg.patch);
    case 'setSnap':
      return [{ ...m, snap: { ...m.snap, ...msg.patch } }, []];
    case 'rotate90':
      return rotateSelection(m, 90);
    case 'resetRotation':
      return resetRotation(m);
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
  if (hit.t === 'rotate') {
    return [
      {
        ...m,
        draft: {
          g: 'rotate',
          ids: hit.ids,
          pivot: hit.pivot,
          start: input.point,
          cur: input.point,
        },
      },
      [],
    ];
  }
  if (hit.t === 'group-handle') {
    return [
      {
        ...m,
        draft: {
          g: 'group',
          op: 'resize',
          ids: hit.ids,
          handle: hit.handle,
          anchor: groupResizeAnchor(hit.box, hit.handle),
          base: hit.box,
          cur: hit.box,
        },
      },
      [],
    ];
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
      ? { g: 'move', ids: selected, start: input.point, delta: { x: 0, y: 0 }, guides: [] }
      : null;
    return [{ ...m, selected, draft }, []];
  }
  return [{ ...m, selected: [] }, []]; // empty (the handler usually pre-empts via 'deselect')
}

function editMove(m: Model, input: PointerInput): [Model, Effect[]] {
  const d = m.draft!;
  // Foreign coordinate frame (see the page-bound gesture rules above) — ignore.
  const home = editDraftPon(m, d);
  if (home != null && input.pon !== home) return [m, []];
  if (d.g === 'move') {
    const raw = clampMoveDelta(m, d.ids, sub(input.point, d.start), input.pageBox);
    if (!m.snap.guides || input.shift)
      return [{ ...m, draft: { ...d, delta: raw, guides: [] } }, []];
    const snap = computeMoveSnap(m, d.ids, input.pon, raw, m.snap.guideThreshold, input.pageBox);
    // A snap adjusts by ≤ threshold, but never past the page edge: re-clamp, and
    // drop the guide on an axis the clamp took back (its line would be a lie).
    const delta = clampMoveDelta(m, d.ids, snap.delta, input.pageBox);
    const guides = snap.guides.filter((g) =>
      g.axis === 'x' ? delta.x === snap.delta.x : delta.y === snap.delta.y,
    );
    return [{ ...m, draft: { ...d, delta, guides } }, []];
  }
  const point = clampPointToBox(input.point, input.pageBox);
  if (d.g === 'handle')
    return [{ ...m, draft: { ...d, cur: geomDragHandle(d.base, d.handle, point) } }, []];
  // Rotation reads the pointer as an ANGLE about the pivot — the raw point is
  // valid (and better) outside the page; the geometry itself never translates.
  // `free` (shift) records the snap bypass for this sample.
  if (d.g === 'rotate') return [{ ...m, draft: { ...d, cur: input.point, free: input.shift } }, []];
  if (d.g === 'group') {
    const iso = selectionHasRotation(m, d.ids);
    return [{ ...m, draft: { ...d, cur: groupResizeBox(d.base, d.handle, point, iso) } }, []];
  }
  return [m, []];
}

function editUp(m: Model): [Model, Effect[]] {
  const d = m.draft!;
  if (d.g === 'handle') {
    // A grab that didn't actually resize leaves the appearance untouched → keep
    // it baked, no engine write.
    if (geomEqual(d.base, d.cur)) return [{ ...m, draft: null }, []];
    // A resize changes the appearance: we own it now → live (vector) render
    // (opaque-body kinds stay baked; the engine re-fits their AP natively).
    const a = ownGeometry({ ...m.byId[d.id], geom: d.cur });
    return [{ ...m, byId: { ...m.byId, [d.id]: a }, draft: null }, [{ fx: 'patch', id: d.id }]];
  }
  if (d.g === 'rotate') {
    const { delta } = rotateDraftDelta(m, d);
    if (Math.abs(delta) < 0.01) return [{ ...m, draft: null }, []];
    const byId = { ...m.byId };
    const fx: Effect[] = [];
    for (const id of d.ids) {
      const a = byId[id];
      if (!a) continue;
      // rotation re-bakes the appearance → live (vector) render + patch.
      byId[id] = ownGeometry({ ...a, geom: geomRotateAbout(a.geom, d.pivot, delta) });
      fx.push({ fx: 'patch', id });
    }
    return [{ ...m, byId, draft: null }, fx];
  }
  if (d.g === 'group') {
    const { sx, sy } = groupResizeFactors(d.base, d.cur);
    if (Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4) return [{ ...m, draft: null }, []];
    const byId = { ...m.byId };
    const fx: Effect[] = [];
    for (const id of d.ids) {
      const a = byId[id];
      if (!a) continue;
      byId[id] = ownGeometry({ ...a, geom: geomScaleAbout(a.geom, d.anchor, sx, sy) });
      fx.push({ fx: 'patch', id });
    }
    return [{ ...m, byId, draft: null }, fx];
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
  // The marquee lives on one page and pins to its box (same rules as editMove).
  const point = clampPointToBox(input.point, input.pageBox);
  if (phase === 'down') {
    return [{ ...m, draft: { g: 'marquee', pon: input.pon, from: point, to: point } }, []];
  }
  if (m.draft?.g !== 'marquee') return [m, []];
  if (m.draft.pon !== input.pon) return [m, []]; // foreign frame — ignore
  if (phase === 'move') {
    return [{ ...m, draft: { ...m.draft, to: point } }, []];
  }

  // A marquee that touches one member takes the whole group with it.
  const hits = expandGroups(m, annotsInBox(m, m.draft.pon, m.draft.from, point));
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
  // An in-progress creation is anchored to its page: a move/up sample from
  // another page is a foreign frame — ignore it. (A DOWN on another page is a
  // fresh intent: the per-subtype branches below start/restart the draft there.)
  if (phase !== 'down' && m.draft && 'pon' in m.draft && m.draft.pon !== input.pon) return [m, []];
  // Shapes can't be drawn past the page edge — the pointer pins to it.
  if (input.pageBox) input = { ...input, point: clampPointToBox(input.point, input.pageBox) };
  if (subtype === 'free-text-callout') return calloutPointer(m, phase, input);
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
  const style = styleFromProps(def);
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
      geom = { t: 'rect', rect: shapeRectFor(dragged, d.ellipse, style), ellipse: d.ellipse };
  } else if (d.g === 'create-line') {
    if (Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y) >= MIN_DRAG)
      geom = { t: 'line', a: d.from, b: d.to, ends: def.lineEndings };
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
    style,
    // A text kind carries its text styling from birth, so the tool's font
    // defaults actually apply to what you draw.
    ...(geom.t === 'text' ? { text: textStyleFromProps(def) } : {}),
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

/** Default text-box size for a callout placed with a click (no box drag). */
const CALLOUT_BOX = { width: 150, height: 40 };

/**
 * The text-box rect for an in-progress callout's `box` step — the ONE rule both
 * the live preview and the commit use, so what you see is what you get. Only a
 * drag past `MIN_DRAG` sizes the box; a press-without-drag (a click) keeps the
 * default-size box anchored at the press point, so it never collapses to a sliver
 * while you decide whether you're dragging (the "bounce"). Before the press
 * (hover), the default box tracks the cursor.
 */
export function calloutBox(d: Extract<Draft, { g: 'create-callout' }>): Rect {
  if (d.boxFrom) {
    const dragged = d.boxTo ? rectFromPoints(d.boxFrom, d.boxTo) : null;
    if (dragged && (dragged.width >= MIN_DRAG || dragged.height >= MIN_DRAG)) return dragged;
    return { x: d.boxFrom.x, y: d.boxFrom.y, ...CALLOUT_BOX };
  }
  return { x: d.cur.x, y: d.cur.y, ...CALLOUT_BOX };
}

/**
 * The free-text callout's multi-step creation, a v2-style 3-click flow:
 *   click 1 (down)  → set the leader `tip`, advance to the `knee` step
 *   hover/move      → preview the leader to the cursor
 *   click 2 (down)  → set the `knee`, advance to the `box` step
 *   drag/click (up) → lay the text box (dragged, or a default box on a click)
 * Commit creates a `free-text` annotation with a `callout` geom and opens it for
 * editing — the connection point to the box is always derived, never stored.
 */
function calloutPointer(
  m: Model,
  phase: 'down' | 'move' | 'up',
  input: PointerInput,
): [Model, Effect[]] {
  const d = m.draft;
  if (phase === 'down') {
    if (d?.g !== 'create-callout' || d.pon !== input.pon) {
      return [
        {
          ...m,
          selected: [],
          draft: {
            g: 'create-callout',
            subtype: 'free-text-callout',
            pon: input.pon,
            step: 'knee',
            tip: input.point,
            cur: input.point,
          },
        },
        [],
      ];
    }
    if (d.step === 'knee') {
      return [{ ...m, draft: { ...d, knee: input.point, step: 'box', cur: input.point } }, []];
    }
    // box step: begin the box drag at this point
    return [{ ...m, draft: { ...d, boxFrom: input.point, boxTo: input.point } }, []];
  }
  if (phase === 'move') {
    if (d?.g !== 'create-callout') return [m, []];
    if (d.step === 'box' && d.boxFrom) return [{ ...m, draft: { ...d, boxTo: input.point } }, []];
    return [{ ...m, draft: { ...d, cur: input.point } }, []];
  }
  // up: only the box step (with a started box) commits; the tip/knee clicks no-op.
  if (d?.g !== 'create-callout' || d.step !== 'box' || !d.boxFrom) return [m, []];
  const rect = calloutBox(d); // the SAME box the preview showed
  const def = defaultsFor(m, 'free-text-callout');
  const ending = def.lineEndings.end !== 'none' ? def.lineEndings.end : 'open-arrow';
  const id = `tmp:${m.seq + 1}`;
  const annot: Annot = {
    id,
    ref: null,
    pon: d.pon,
    subtype: 'free-text',
    geom: { t: 'text', rect, callout: { tip: d.tip, knee: d.knee, ending } },
    style: styleFromProps(def),
    text: textStyleFromProps(def),
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
      editing: id,
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
    ends: d.closed ? undefined : def.lineEndings,
  };
  const id = `tmp:${m.seq + 1}`;
  const annot: Annot = {
    id,
    ref: null,
    pon: d.pon,
    subtype: d.subtype,
    geom,
    style: styleFromProps(def),
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
    style: styleFromProps(defaultsFor(m, subtype)),
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
    style: styleFromProps(def),
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

/**
 * Apply a flat property patch to the current selection. Each member takes only
 * the keys its KIND declares (see `applyProps` — routing to `style`, `geom.ends`
 * or `text` happens there) and ignores the rest, so one patch restyles a mixed
 * selection. Changed members flip to `vector` (we own the appearance now) and
 * emit one engine patch each. The base style / tool defaults are NEVER touched:
 * editing existing annotations must not change what the next drawn one looks like.
 */
function setProps(m: Model, patch: AnnotationPropsPatch): [Model, Effect[]] {
  if (!m.selected.length) return [m, []];
  const byId = { ...m.byId };
  const fx: Effect[] = [];
  for (const id of m.selected) {
    const a = byId[id];
    if (!a) continue;
    const next = applyProps(a, patch);
    if (!next) continue; // locked, or no declared key in the patch
    byId[id] = toVector(next);
    fx.push({ fx: 'patch', id });
  }
  return fx.length ? [{ ...m, byId }, fx] : [m, []];
}

function setDefaults(m: Model, subtype: Subtype, patch: AnnotationPropsPatch): [Model, Effect[]] {
  const prev = m.defaults[subtype] ?? {};
  const next: AnnotationPropsPatch = { ...prev, ...patch };
  // Endings merge per side, so `{ end: 'open-arrow' }` keeps a configured start.
  if (patch.lineEndings) next.lineEndings = { ...prev.lineEndings, ...patch.lineEndings };
  return [{ ...m, defaults: { ...m.defaults, [subtype]: next } }, []];
}

/**
 * Rotate the current selection by `deltaDeg` (clockwise) — the toolbar
 * "rotate 90°" affordance. A single shape turns about its own centre; a
 * multi-target group about the union-box centre (gated by `groupRotatable` for
 * groups, `rotatable` for a single shape). Emits one patch per rotated member.
 */
function rotateSelection(m: Model, deltaDeg: number): [Model, Effect[]] {
  const ids = m.selected.filter((id) => {
    const a = m.byId[id];
    return a && !a.locked && capsFor(a.subtype).rotatable;
  });
  if (!ids.length) return [m, []];
  // pivot: a single shape's own selection-rect centre (so vertex kinds spin in
  // place, not about their off-centre vertex mean); a group's union-box centre.
  let pivot: Vec;
  if (ids.length === 1) {
    const a = m.byId[ids[0]];
    pivot = selectionCenter(a.geom, a.style.strokeWidth);
  } else {
    const pon = m.byId[ids[0]].pon;
    const union = groupUnionBounds({ ...m, selected: ids }, pon);
    if (!union) return [m, []];
    pivot = { x: union.x + union.width / 2, y: union.y + union.height / 2 };
  }
  const byId = { ...m.byId };
  const fx: Effect[] = [];
  for (const id of ids) {
    byId[id] = ownGeometry({ ...byId[id], geom: geomRotateAbout(byId[id].geom, pivot, deltaDeg) });
    fx.push({ fx: 'patch', id });
  }
  return [{ ...m, byId }, fx];
}

/** Reset rotation on the selection to the as-authored orientation. */
function resetRotation(m: Model): [Model, Effect[]] {
  const byId = { ...m.byId };
  const fx: Effect[] = [];
  for (const id of m.selected) {
    const a = byId[id];
    if (!a || a.locked || geomRotation(a.geom) === 0) continue;
    byId[id] = ownGeometry({ ...a, geom: geomResetRotation(a.geom) });
    fx.push({ fx: 'patch', id });
  }
  return fx.length ? [{ ...m, byId }, fx] : [m, []];
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
      // intersect against the ROTATED extent (AABB of the oriented quad), so a
      // marquee catches a tilted shape by what's actually drawn, not its footprint.
      rectsIntersect(
        unionRect(
          selectionQuad(m.byId[id].geom, m.byId[id].style.strokeWidth, m.byId[id].style.border),
        ),
        box,
      ),
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
  if (draft.g === 'rotate' || draft.g === 'group') return new Set(draft.ids);
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
