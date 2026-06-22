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
  Color,
  PdfRect,
  PdfRectDifferences,
} from '@embedpdf/engine-core/runtime';
import {
  cloudyBorderExtent,
  contentToPdfPoint,
  contentToPdfRect,
  geomPdfBounds,
  pdfToContentPoint,
  pdfToContentRect,
  type Annot,
  type Border,
  type Geom,
  type Quad,
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
const colorToCss = (c: Color): string => `#${h2(c.r)}${h2(c.g)}${h2(c.b)}`;
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
const STROKE_KINDS = new Set(['square', 'circle', 'line', 'polygon', 'polyline']);

/** Engine DTO → content-space Annot (loaded = baked). */
export function fromDTO(dto: AnnotationDTO, crop: PdfRect): Annot {
  const base = {
    id: refKey(dto.ref),
    ref: dto.ref,
    pon: dto.pageObjectNumber,
    subtype: dto.subtype,
    locked: dto.flags.locked || dto.flags.readOnly,
    source: 'baked' as const,
  };
  return { ...base, geom: geomFromDTO(dto, crop), style: styleFromDTO(dto) };
}

function geomFromDTO(dto: AnnotationDTO, crop: PdfRect): Geom {
  switch (dto.subtype) {
    case 'square':
      return { t: 'rect', rect: pdfToContentRect(dto.rect, crop), ellipse: false };
    case 'circle':
      return { t: 'rect', rect: pdfToContentRect(dto.rect, crop), ellipse: true };
    case 'line':
      return {
        t: 'line',
        a: pdfToContentPoint(dto.linePoints.start, crop),
        b: pdfToContentPoint(dto.linePoints.end, crop),
        ends: dto.lineEndings,
      };
    case 'polyline':
      return {
        t: 'poly',
        points: dto.vertices.map((p) => pdfToContentPoint(p, crop)),
        closed: false,
        ends: dto.lineEndings,
      };
    case 'polygon':
      return {
        t: 'poly',
        points: dto.vertices.map((p) => pdfToContentPoint(p, crop)),
        closed: true,
      };
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
    default:
      return { t: 'rect', rect: pdfToContentRect(dto.rect, crop), ellipse: false };
  }
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

function styleFromDTO(dto: AnnotationDTO): Style {
  if (STROKE_KINDS.has(dto.subtype)) {
    const d = dto as Extract<AnnotationDTO, { strokeColor: Color }>;
    return {
      strokeColor: colorToCss(d.strokeColor),
      fillColor: d.interiorColor ? colorToCss(d.interiorColor) : null,
      strokeWidth: d.strokeWidth,
      opacity: d.opacity,
      border: borderFromDTO(d),
    };
  }
  if (TEXT_MARKUP.has(dto.subtype)) {
    const d = dto as Extract<AnnotationDTO, { color: Color }>;
    const css = colorToCss(d.color);
    return {
      strokeColor: css,
      fillColor: css,
      strokeWidth: 0,
      opacity: d.opacity,
      border: { kind: 'solid' },
    };
  }
  return {
    strokeColor: '#444444',
    fillColor: null,
    strokeWidth: 1,
    opacity: 1,
    border: { kind: 'solid' },
  };
}

/* ── content Annot → engine draft / patch ─────────────────────────────────── */

const strokeFill = (style: Style) => ({
  strokeColor: cssToColor(style.strokeColor),
  interiorColor: style.fillColor ? cssToColor(style.fillColor) : null,
  strokeWidth: style.strokeWidth,
  opacity: style.opacity,
  // /BS /S + /BS /D — a cloudy border keeps a solid underlying stroke (the
  // scallops are the /BE effect, applied via shapeExtras).
  borderStyle: style.border.kind === 'dashed' ? ('dashed' as const) : ('solid' as const),
  ...(style.border.kind === 'dashed' ? { dashArray: style.border.dash } : {}),
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

function geomFields(a: Annot, crop: PdfRect) {
  const g = a.geom;
  const sw = a.style.strokeWidth;
  if (g.t === 'rect') return { rect: contentToPdfRect(g.rect, crop) };
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
  return null; // quads (markup) — geometry edits not supported in v1
}

/** Content Annot → engine create draft (square/circle/line in v1; null otherwise). */
export function toCreateDraft(a: Annot, crop: PdfRect): AnnotationDraft | null {
  const f = geomFields(a, crop);
  const sf = strokeFill(a.style);
  if (a.subtype === 'square' && f && 'rect' in f)
    return { subtype: 'square', rect: f.rect, ...sf, ...shapeExtras(a) };
  if (a.subtype === 'circle' && f && 'rect' in f)
    return { subtype: 'circle', rect: f.rect, ...sf, ...shapeExtras(a) };
  if (a.subtype === 'line' && f && 'linePoints' in f)
    return {
      subtype: 'line',
      linePoints: f.linePoints,
      lineEndings: f.lineEndings,
      rect: f.rect,
      ...sf,
    };
  return null;
}

/** Content Annot → engine geometry+style patch (all editable kinds). */
export function toPatch(a: Annot, crop: PdfRect): AnnotationPatch | null {
  const f = geomFields(a, crop);
  const sf = strokeFill(a.style);
  if (a.subtype === 'square' && f && 'rect' in f)
    return { subtype: 'square', rect: f.rect, ...sf, ...shapeExtras(a) };
  if (a.subtype === 'circle' && f && 'rect' in f)
    return { subtype: 'circle', rect: f.rect, ...sf, ...shapeExtras(a) };
  if (a.subtype === 'line' && f && 'linePoints' in f)
    return {
      subtype: 'line',
      linePoints: f.linePoints,
      lineEndings: f.lineEndings,
      rect: f.rect,
      ...sf,
    };
  if (a.subtype === 'polygon' && f && 'vertices' in f)
    return { subtype: 'polygon', vertices: f.vertices, rect: f.rect, ...sf };
  if (a.subtype === 'polyline' && f && 'vertices' in f)
    return {
      subtype: 'polyline',
      vertices: f.vertices,
      lineEndings: f.lineEndings,
      rect: f.rect,
      ...sf,
    };
  return null;
}
