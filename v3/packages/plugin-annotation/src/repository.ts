/**
 * The boundary between the engine's PDF-space annotation DTOs and the core's
 * content-space `Annot`. The ONLY place this plugin crosses the geometry seam
 * (the bridge) and the colour seam (engine `Color` ↔ CSS). Covers all 9 kinds.
 */
import type {
  AnnotationDraft,
  AnnotationDTO,
  AnnotationPatch,
  AnnotationRef,
  CalloutLine,
  Color,
  InkList,
  LineEnding,
  LineEndings,
  LinePoints,
  PdfPoint,
  PdfRect,
  PdfRectDifferences,
} from '@embedpdf/engine-core/runtime';
import {
  calloutLinePoints,
  cloudyBorderExtent,
  contentToPdfPoint,
  contentToPdfRect,
  geomPdfBounds,
  geomRotation,
  normalizeDeg,
  pdfToContentPoint,
  pdfToContentRect,
  rotatedAabb,
  type Annot,
  type Border,
  type Geom,
  type Quad,
  type Rect,
  type Style,
} from '@embedpdf-x/annotation-core';

export function refKey(ref: AnnotationRef): string {
  return ref.kind === 'objectNumber'
    ? `obj:${ref.annotObjectNumber}`
    : ref.kind === 'nm'
      ? `nm:${ref.nm}`
      : `idx:${ref.pageObjectNumber}:${ref.index}`;
}

const h2 = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');
export const colorToCss = (c: Color): string => `#${h2(c.r)}${h2(c.g)}${h2(c.b)}`;
function cssToColor(css: string): Color {
  const s = css.trim();
  const m6 = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m6) {
    const n = parseInt(m6[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const m3 = /^#?([0-9a-f]{3})$/i.exec(s);
  if (m3) {
    const [a, b, c] = m3[1];
    return { r: parseInt(a + a, 16), g: parseInt(b + b, 16), b: parseInt(c + c, 16) };
  }
  return { r: 0, g: 0, b: 0 };
}

const TEXT_MARKUP = new Set(['highlight', 'underline', 'squiggly', 'strikeout']);
// Geometric kinds that carry the `/C` stroke colour + `/BS` border. Ink belongs
// here too (it has a stroke but no `/IC`, so its interiorColor reads back null).
const STROKE_KINDS = new Set(['square', 'circle', 'line', 'polygon', 'polyline', 'ink']);

/* ── rotation seam (CW content ↔ PDF convention) ──────────────────────────────
 * The model's `rot` is CLOCKWISE in content space (y-down). PDF user space is
 * y-up, so the y-flip at this boundary turns a CW content tilt into a CCW PDF
 * tilt of the same magnitude — i.e. the stored `/EMBD_Metadata/Rotation` is the
 * NEGATION (mod 360). This is the ONE place the convention is converted; every
 * layer above speaks CW-content and the engine/PDFium speaks the PDF angle.
 */
const toPdfRotation = (rotCW: number): number => normalizeDeg(-rotCW);
const fromPdfRotation = (rotPdf: number): number => normalizeDeg(-rotPdf);

/**
 * Geometry/rotation fields for a BOX kind (square/circle/plain free-text). The
 * model's `rect` is the UNROTATED logical box and `rot` the applied tilt, so:
 *  - rot == 0 → `/Rect` IS the box; no rotation metadata.
 *  - rot != 0 → `/Rect` is the rotated visual AABB (PDFium clips the baked /AP to
 *    it), `unrotatedRect` is the logical box, and `rotation` the PDF angle. The
 *    engine bakes a portable `/AP /Matrix` from those two.
 */
function boxGeomFields(
  rect: Rect,
  rot: number,
  crop: PdfRect,
): { rect: PdfRect; unrotatedRect?: PdfRect; rotation?: number } {
  if (!rot) return { rect: contentToPdfRect(rect, crop) };
  return {
    rect: contentToPdfRect(rotatedAabb(rect, rot), crop),
    unrotatedRect: contentToPdfRect(rect, crop),
    rotation: toPdfRotation(rot),
  };
}

/** Advisory rotation for a VERTEX kind (line/poly/ink): the points are already
 *  rotated, so this scalar is inert for AP — it just records the applied angle so
 *  EmbedPDF can show an oriented box + offer reset. Absent when not rotated. */
const advisoryRotation = (g: Geom): { rotation?: number } => {
  const rot = geomRotation(g);
  return rot ? { rotation: toPdfRotation(rot) } : {};
};

/**
 * Engine DTO → content-space Annot. `source` decides how it renders: `'baked'`
 * shows the engine's appearance raster (a page load, or a remote edit — trust
 * the authored AP); `'vector'` renders live from geom/style (we authored or
 * changed it). `apBox` is the raster's content-space box, used while baked.
 */
export function fromDTO(
  dto: AnnotationDTO,
  crop: PdfRect,
  source: 'baked' | 'vector' = 'baked',
): Annot {
  const base = {
    id: refKey(dto.ref),
    ref: dto.ref,
    pon: dto.pageObjectNumber,
    subtype: dto.subtype,
    locked: dto.flags.locked || dto.flags.readOnly,
    source,
    // Carry the canonical DTO; geom/style below are derived projections of it.
    data: dto,
    // Relationship to a parent annotation. `irt` mirrors `/IRT`; `group` is the
    // primary's key for `/RT /Group` subordinates only (a visual group acts as a
    // unit). `/RT /R` (comment replies) keep `irt` but are NOT a visual group.
    ...(dto.inReplyTo ? { irt: refKey(dto.inReplyTo) } : {}),
    ...(dto.replyType === 'group' && dto.inReplyTo ? { group: refKey(dto.inReplyTo) } : {}),
  };
  return {
    ...base,
    geom: geomFromDTO(dto, crop),
    style: styleFromDTO(dto),
    apBox: pdfToContentRect(dto.rect, crop),
  };
}

function geomFromDTO(dto: AnnotationDTO, crop: PdfRect): Geom {
  switch (dto.subtype) {
    case 'square':
      return boxGeomFromDTO(dto, dto.rotation, dto.unrotatedRect, crop, false);
    case 'circle':
      return boxGeomFromDTO(dto, dto.rotation, dto.unrotatedRect, crop, true);
    case 'line':
      return {
        t: 'line',
        a: pdfToContentPoint(dto.linePoints.start, crop),
        b: pdfToContentPoint(dto.linePoints.end, crop),
        ends: dto.lineEndings,
        ...rotFromDTO(dto.rotation),
      };
    case 'polyline':
      return {
        t: 'poly',
        points: dto.vertices.map((p) => pdfToContentPoint(p, crop)),
        closed: false,
        ends: dto.lineEndings,
        ...rotFromDTO(dto.rotation),
      };
    case 'polygon':
      return {
        t: 'poly',
        points: dto.vertices.map((p) => pdfToContentPoint(p, crop)),
        closed: true,
        ...rotFromDTO(dto.rotation),
      };
    case 'ink':
      return {
        t: 'ink',
        strokes: dto.inkList.map((stroke) => stroke.map((p) => pdfToContentPoint(p, crop))),
        ...rotFromDTO(dto.rotation),
      };
    case 'free-text': {
      // A callout (`/IT free-text-callout` + a `/CL` leader): the stored `rect` is
      // the TEXT BOX (the overall `/Rect` inset by `/RD`); the leader's tip is
      // `cl[0]` and the elbow `cl[1]` (a 3-point `/CL`). The connection point —
      // `cl` last — is NOT stored; it's re-derived from the box.
      if (dto.intent === 'free-text-callout' && dto.calloutLine && dto.calloutLine.length >= 2) {
        const cl = dto.calloutLine;
        return {
          t: 'text',
          rect: pdfToContentRect(insetPdfRectByRD(dto.rect, dto.rectDifferences), crop),
          callout: {
            tip: pdfToContentPoint(cl[0], crop),
            knee: cl.length === 3 ? pdfToContentPoint(cl[1], crop) : undefined,
            ending: dto.lineEnding ?? 'none',
          },
        };
      }
      // Plain text box: a box kind — read back the unrotated box + advisory tilt.
      const rot = dto.rotation ? fromPdfRotation(dto.rotation) : 0;
      const box = rot && dto.unrotatedRect ? dto.unrotatedRect : dto.rect;
      return { t: 'text', rect: pdfToContentRect(box, crop), ...(rot ? { rot } : {}) };
    }
    case 'highlight':
    case 'underline':
    case 'squiggly':
    case 'strikeout':
      return {
        t: 'quads',
        quads: dto.quadPoints.map(
          (q) =>
            [
              pdfToContentPoint(q.p1, crop),
              pdfToContentPoint(q.p2, crop),
              pdfToContentPoint(q.p3, crop),
              pdfToContentPoint(q.p4, crop),
            ] as Quad,
        ),
      };
    case 'caret':
      return { t: 'caret', rect: pdfToContentRect(dto.rect, crop) };
    default:
      return { t: 'rect', rect: pdfToContentRect(dto.rect, crop), ellipse: false };
  }
}

/** Advisory `rot` for a vertex geom, from a DTO's (PDF-convention) `rotation`.
 *  Absent → no `rot` key (kept off the geom so unrotated shapes stay clean). */
const rotFromDTO = (rotation?: number): { rot?: number } =>
  rotation ? { rot: fromPdfRotation(rotation) } : {};

/** A box geom (square/circle) from its DTO: when rotated, the LOCAL box is the
 *  stored `unrotatedRect` (the AABB `/Rect` is the rendered envelope) and `rot`
 *  the converted tilt; unrotated, `/Rect` IS the box. */
function boxGeomFromDTO(
  dto: { rect: PdfRect },
  rotation: number | undefined,
  unrotatedRect: PdfRect | undefined,
  crop: PdfRect,
  ellipse: boolean,
): Geom {
  const rot = rotation ? fromPdfRotation(rotation) : 0;
  const box = rot && unrotatedRect ? unrotatedRect : dto.rect;
  return { t: 'rect', rect: pdfToContentRect(box, crop), ellipse, ...(rot ? { rot } : {}) };
}

/** Engine border fields (`/BS /S`, `/BS /D`, `/BE /I`) → the `Border` union. A
 *  cloudy effect wins over the underlying border style (which stays solid). */
function borderFromDTO(d: {
  borderStyle?: string;
  dashArray?: number[];
  cloudyIntensity?: number;
}): Border {
  if ((d.cloudyIntensity ?? 0) > 0) return { kind: 'cloudy', intensity: d.cloudyIntensity! };
  if (d.borderStyle === 'dashed')
    return { kind: 'dashed', dash: d.dashArray?.length ? d.dashArray : [3, 3] };
  return { kind: 'solid' };
}

/** Engine DTO → content-space `Style` (CSS colours, `Border` union). Exported so
 *  selection-aware UIs can read display values straight off a {@link AnnotationDTO}
 *  without re-deriving the colour/border mapping. */
export function styleFromDTO(dto: AnnotationDTO): Style {
  if (STROKE_KINDS.has(dto.subtype)) {
    const d = dto as Extract<AnnotationDTO, { interiorColor: Color | null }>;
    return {
      color: colorToCss(d.color),
      interiorColor: d.interiorColor ? colorToCss(d.interiorColor) : null,
      strokeWidth: d.strokeWidth,
      opacity: d.opacity,
      border: borderFromDTO(d),
    };
  }
  if (TEXT_MARKUP.has(dto.subtype)) {
    const d = dto as Extract<AnnotationDTO, { color: Color }>;
    return {
      color: colorToCss(d.color),
      interiorColor: null,
      strokeWidth: 0,
      opacity: d.opacity,
      border: { kind: 'solid' },
    };
  }
  if (dto.subtype === 'caret') {
    const d = dto as Extract<AnnotationDTO, { color: Color; opacity: number }>;
    return {
      color: colorToCss(d.color),
      interiorColor: null,
      strokeWidth: 1,
      opacity: d.opacity,
      border: { kind: 'solid' },
    };
  }
  if (dto.subtype === 'free-text') {
    // `/DA` colour is the border + leader stroke; `/C` is the box background; `/BS`
    // gives the width. A plain text box draws no vector scene, so these only matter
    // for a callout's leader/arrow/box-border (and the style toolbar's readout).
    const d = dto as Extract<AnnotationDTO, { subtype: 'free-text' }>;
    return {
      color: colorToCss(d.color),
      interiorColor: d.interiorColor ? colorToCss(d.interiorColor) : null,
      strokeWidth: d.strokeWidth,
      opacity: d.opacity,
      border: borderFromDTO(d),
    };
  }
  return {
    color: '#444444',
    interiorColor: null,
    strokeWidth: 1,
    opacity: 1,
    border: { kind: 'solid' },
  };
}

/* ── content Annot → engine draft / patch ─────────────────────────────────── */

/** The geometry styling shared by every geometric kind: `/C`, `/CA`, `/BS`
 *  (no `/IC`). Ink uses exactly this; the filled kinds add `interiorColor`. */
const geometryStyle = (style: Style) => ({
  color: cssToColor(style.color),
  strokeWidth: style.strokeWidth,
  opacity: style.opacity,
  // /BS /S + /BS /D — a cloudy border keeps a solid underlying stroke (the
  // scallops are the /BE effect, applied via shapeExtras).
  borderStyle: style.border.kind === 'dashed' ? ('dashed' as const) : ('solid' as const),
  ...(style.border.kind === 'dashed' ? { dashArray: style.border.dash } : {}),
});

const strokeFill = (style: Style) => ({
  ...geometryStyle(style),
  interiorColor: style.interiorColor ? cssToColor(style.interiorColor) : null,
});

/** Text markup carries a single `/C` colour (our model keeps stroke==fill) + `/CA`
 *  opacity. Geometry is the `/QuadPoints`, set on create and never patched. */
const markupColor = (style: Style) => ({
  color: cssToColor(style.color),
  opacity: style.opacity,
});

const caretStyle = (style: Style) => ({
  color: cssToColor(style.color),
  opacity: style.opacity,
  rectDifferences: { left: 0.5, top: 0.5, right: 0.5, bottom: 0.5 },
});

/**
 * Cloudy-border fields for a shape (/BE intensity + /RD inset). The /Rect we send
 * is the OUTER box, and /RD tells the engine how far to inset the drawn geometry
 * so the scallops bulge back out to that box — derived, never stored on the model.
 * For a non-cloudy shape we explicitly clear both, so toggling cloudy OFF in a
 * patch removes the effect rather than leaving stale entries.
 */
function shapeExtras(a: Annot): { cloudyIntensity?: number; rectDifferences?: PdfRectDifferences } {
  if (a.geom.t !== 'rect') return {};
  if (a.style.border.kind === 'cloudy') {
    const inset = cloudyBorderExtent(a.style.border.intensity, a.style.strokeWidth, a.geom.ellipse);
    return {
      cloudyIntensity: a.style.border.intensity,
      rectDifferences: { left: inset, top: inset, right: inset, bottom: inset },
    };
  }
  return { cloudyIntensity: 0, rectDifferences: undefined };
}

/** Inset a PdfRect by a `/RD` (PDF user space, y-up: all four are non-negative
 *  insets from the matching `/Rect` edge). Used to recover the callout text box. */
const insetPdfRectByRD = (r: PdfRect, rd?: PdfRectDifferences): PdfRect =>
  rd
    ? {
        left: r.left + rd.left,
        bottom: r.bottom + rd.bottom,
        right: r.right - rd.right,
        top: r.top - rd.top,
      }
    : r;

/**
 * The engine geometry for a callout: the overall `/Rect` (text box ∪ leader ∪
 * arrow), the `/RD` inset that recovers the text box from it, the `/CL` leader
 * (`[tip, knee, conn]` with the connection point derived), and the `/LE` ending.
 * All in PDF user space (y-up), with every `/RD` inset clamped non-negative.
 */
function calloutFields(
  a: Annot,
  crop: PdfRect,
): {
  rect: PdfRect;
  rectDifferences: PdfRectDifferences;
  calloutLine: CalloutLine;
  lineEnding: LineEnding;
} | null {
  const g = a.geom;
  if (g.t !== 'text' || !g.callout) return null;
  const overall = geomPdfBounds(g, a.style.strokeWidth, crop);
  const tb = contentToPdfRect(g.rect, crop);
  const nn = (n: number) => Math.max(0, n);
  const pts = calloutLinePoints(g).map((p) => contentToPdfPoint(p, crop));
  const calloutLine = (
    pts.length === 3 ? [pts[0], pts[1], pts[2]] : [pts[0], pts[1]]
  ) as CalloutLine;
  return {
    rect: overall,
    rectDifferences: {
      left: nn(tb.left - overall.left),
      bottom: nn(tb.bottom - overall.bottom),
      right: nn(overall.right - tb.right),
      top: nn(overall.top - tb.top),
    },
    calloutLine,
    lineEnding: g.callout.ending,
  };
}

type GeomFields =
  | { rect: PdfRect }
  | { linePoints: LinePoints; lineEndings: LineEndings | undefined; rect: PdfRect }
  | { vertices: PdfPoint[]; lineEndings: LineEndings | undefined; rect: PdfRect }
  | { inkList: InkList; rect: PdfRect };

function geomFields(a: Annot, crop: PdfRect): GeomFields | null {
  const g = a.geom;
  const sw = a.style.strokeWidth;
  // /Rect IS `g.rect` (the outer box) for every shape; a cloudy border's geometry is
  // inset from it by /RD (see shapeExtras), and the scallops fill back out to it.
  if (g.t === 'rect' || g.t === 'text' || g.t === 'caret')
    return { rect: contentToPdfRect(g.rect, crop) };
  if (g.t === 'line') {
    return {
      linePoints: { start: contentToPdfPoint(g.a, crop), end: contentToPdfPoint(g.b, crop) },
      lineEndings: g.ends,
      // VISUAL bounds (stroke + endings) — the engine clips the baked /AP to /Rect.
      rect: geomPdfBounds(g, sw, crop),
    };
  }
  if (g.t === 'poly') {
    return {
      vertices: g.points.map((p) => contentToPdfPoint(p, crop)),
      lineEndings: g.ends,
      rect: geomPdfBounds(g, sw, crop),
    };
  }
  if (g.t === 'ink') {
    return {
      inkList: g.strokes.map((stroke) => stroke.map((p) => contentToPdfPoint(p, crop))),
      // VISUAL bounds (stroke radius incl.) — the engine clips the baked /AP to /Rect.
      rect: geomPdfBounds(g, sw, crop),
    };
  }
  return null; // quads (markup) — built separately via quadPointsFor
}

/** Markup geometry: content-space quads → engine `/QuadPoints` (PDF user space).
 *  Kept out of `geomFields` so that union stays rect/line/poly and its `'rect' in f`
 *  narrowing is unaffected. */
function quadPointsFor(a: Annot, crop: PdfRect) {
  if (a.geom.t !== 'quads') return null;
  return a.geom.quads.map((q) => ({
    p1: contentToPdfPoint(q[0], crop),
    p2: contentToPdfPoint(q[1], crop),
    p3: contentToPdfPoint(q[2], crop),
    p4: contentToPdfPoint(q[3], crop),
  }));
}

/** Box geometry+rotation fields for the emit side (square/circle/plain free-text):
 *  the model's unrotated `rect` + applied `rot`, mapped to `/Rect`(+`unrotatedRect`
 *  +`rotation`). The geom is always a box here (the callers gate on subtype). */
const boxEmit = (a: Annot, crop: PdfRect) => {
  const g = a.geom as Extract<Geom, { t: 'rect' } | { t: 'text' }>;
  return boxGeomFields(g.rect, geomRotation(a.geom), crop);
};

/** Content Annot → engine create draft (square/circle/line in v1; null otherwise). */
export function toCreateDraft(a: Annot, crop: PdfRect): AnnotationDraft | null {
  const f = geomFields(a, crop);
  const sf = strokeFill(a.style);
  if (a.subtype === 'square' && f && 'rect' in f)
    return { subtype: 'square', ...boxEmit(a, crop), ...sf, ...shapeExtras(a) };
  if (a.subtype === 'circle' && f && 'rect' in f)
    return { subtype: 'circle', ...boxEmit(a, crop), ...sf, ...shapeExtras(a) };
  if (a.subtype === 'line' && f && 'linePoints' in f)
    return {
      subtype: 'line',
      linePoints: f.linePoints,
      lineEndings: f.lineEndings,
      rect: f.rect,
      ...sf,
      ...advisoryRotation(a.geom),
    };
  if (a.subtype === 'polygon' && f && 'vertices' in f)
    return {
      subtype: 'polygon',
      vertices: f.vertices,
      rect: f.rect,
      ...sf,
      ...advisoryRotation(a.geom),
    };
  if (a.subtype === 'polyline' && f && 'vertices' in f)
    return {
      subtype: 'polyline',
      vertices: f.vertices,
      lineEndings: f.lineEndings,
      rect: f.rect,
      ...sf,
      ...advisoryRotation(a.geom),
    };
  if (a.subtype === 'ink' && f && 'inkList' in f)
    return {
      subtype: 'ink',
      inkList: f.inkList,
      rect: f.rect,
      ...geometryStyle(a.style),
      ...advisoryRotation(a.geom),
    };
  if (a.subtype === 'free-text' && f && 'rect' in f) {
    // text style — defaults for a fresh box; the user edits font/size later.
    const text = {
      fontFamily: 'helvetica',
      fontSize: 14,
      textAlign: 'left',
      contents: a.data?.contents ?? '',
      color: cssToColor(a.style.color), // `/DA` colour (border + default text)
      interiorColor: a.style.interiorColor ? cssToColor(a.style.interiorColor) : null,
      opacity: a.style.opacity,
    };
    const cf = calloutFields(a, crop);
    if (cf)
      return {
        subtype: 'free-text',
        intent: 'free-text-callout',
        rect: cf.rect, // overall /Rect (box ∪ leader ∪ arrow)
        rectDifferences: cf.rectDifferences,
        calloutLine: cf.calloutLine,
        lineEnding: cf.lineEnding,
        strokeWidth: a.style.strokeWidth, // /BS /W — the leader + box border weight
        ...text,
      } as AnnotationDraft;
    return {
      subtype: 'free-text',
      intent: 'free-text',
      ...boxEmit(a, crop),
      ...text,
    } as AnnotationDraft;
  }
  if (a.subtype === 'caret' && f && 'rect' in f)
    return { subtype: 'caret', rect: f.rect, ...caretStyle(a.style) };
  const quads = quadPointsFor(a, crop);
  if (TEXT_MARKUP.has(a.subtype) && quads)
    return { subtype: a.subtype, quadPoints: quads, ...markupColor(a.style) } as AnnotationDraft;
  return null;
}

/** Content Annot → engine geometry+style patch (all editable kinds). */
export function toPatch(a: Annot, crop: PdfRect): AnnotationPatch | null {
  const f = geomFields(a, crop);
  const sf = strokeFill(a.style);
  if (a.subtype === 'square' && f && 'rect' in f)
    return { subtype: 'square', ...boxEmit(a, crop), ...sf, ...shapeExtras(a) };
  if (a.subtype === 'circle' && f && 'rect' in f)
    return { subtype: 'circle', ...boxEmit(a, crop), ...sf, ...shapeExtras(a) };
  if (a.subtype === 'line' && f && 'linePoints' in f)
    return {
      subtype: 'line',
      linePoints: f.linePoints,
      lineEndings: f.lineEndings,
      rect: f.rect,
      ...sf,
      ...advisoryRotation(a.geom),
    };
  if (a.subtype === 'polygon' && f && 'vertices' in f)
    return {
      subtype: 'polygon',
      vertices: f.vertices,
      rect: f.rect,
      ...sf,
      ...advisoryRotation(a.geom),
    };
  if (a.subtype === 'polyline' && f && 'vertices' in f)
    return {
      subtype: 'polyline',
      vertices: f.vertices,
      lineEndings: f.lineEndings,
      rect: f.rect,
      ...sf,
      ...advisoryRotation(a.geom),
    };
  if (a.subtype === 'ink' && f && 'inkList' in f)
    return {
      subtype: 'ink',
      inkList: f.inkList,
      rect: f.rect,
      ...geometryStyle(a.style),
      ...advisoryRotation(a.geom),
    };
  // free-text move/resize: send the box. Text content is committed separately
  // (the debounced `update(contents)` while typing), so it's not duplicated here.
  // A callout sends the overall /Rect + the leader (/CL, /RD, /LE) on every
  // geometry/leader edit, so the box, tip, and knee all round-trip.
  if (a.subtype === 'free-text' && f && 'rect' in f) {
    const cf = calloutFields(a, crop);
    if (cf)
      return {
        subtype: 'free-text',
        rect: cf.rect,
        rectDifferences: cf.rectDifferences,
        calloutLine: cf.calloutLine,
        lineEnding: cf.lineEnding,
      } as AnnotationPatch;
    return { subtype: 'free-text', ...boxEmit(a, crop) } as AnnotationPatch;
  }
  if (a.subtype === 'caret' && f && 'rect' in f)
    return { subtype: 'caret', rect: f.rect, ...caretStyle(a.style) };
  // markup: recolor / opacity only — /QuadPoints geometry isn't edited after create
  if (TEXT_MARKUP.has(a.subtype))
    return { subtype: a.subtype, ...markupColor(a.style) } as AnnotationPatch;
  return null;
}
