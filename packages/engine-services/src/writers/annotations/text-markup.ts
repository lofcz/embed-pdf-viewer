import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';
import {
  EngineError,
  EngineErrorCode,
  type Color,
  type HighlightDraft,
  type HighlightPatch,
  type QuadPoint,
  type SquigglyDraft,
  type SquigglyPatch,
  type StrikeoutDraft,
  type StrikeoutPatch,
  type UnderlineDraft,
  type UnderlinePatch,
} from '@embedpdf/engine-core/runtime';
import { applyAnnotationBaseDraft, applyAnnotationBasePatch } from './base';

const FPDFANNOT_COLORTYPE_Color = 0;

/**
 * Default opacity when a draft omits `opacity`. PDFium's /CA defaults to
 * 1.0 if absent from the dict, but we set it explicitly so reads always
 * round-trip the same value.
 */
const DEFAULT_OPACITY = 1;

/**
 * Default fill colour per text-markup subtype. Matches the read-side
 * fallback in `readers/annotations/text-markup.ts`.
 */
const DEFAULT_HIGHLIGHT_COLOR: Color = { r: 255, g: 255, b: 0 };
const DEFAULT_TEXT_MARKUP_COLOR: Color = { r: 0, g: 0, b: 0 };

export type TextMarkupDraft = HighlightDraft | UnderlineDraft | SquigglyDraft | StrikeoutDraft;
export type TextMarkupPatch = HighlightPatch | UnderlinePatch | SquigglyPatch | StrikeoutPatch;

/**
 * Apply a text-markup draft to a freshly-created annotation. Caller is
 * responsible for `EPDFPage_CreateAnnot`; this function only writes
 * fields. Order:
 *   1. base author-metadata (contents/author/nm)
 *   2. quadPoints (required for text-markup; 0-length is a typed error)
 *   3. rect (computed from quadPoints when not supplied — text-markup
 *      annotations require /Rect to be the smallest enclosing box)
 *   4. color (with subtype-aware fallback)
 *   5. opacity (/CA)
 */
export function applyTextMarkupDraft(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  draft: TextMarkupDraft,
): void {
  applyAnnotationBaseDraft(fn, mem, annotPtr, draft);

  const quadPoints = draft.quadPoints;
  if (!Array.isArray(quadPoints) || quadPoints.length === 0) {
    throw new EngineError(
      EngineErrorCode.InvalidArg,
      `text-markup draft (${draft.subtype}) requires at least one quadPoint`,
    );
  }
  appendQuadPoints(fn, mem, annotPtr, quadPoints);
  setRectFromQuadPoints(fn, mem, annotPtr, quadPoints);

  const fallback =
    draft.subtype === 'highlight' ? DEFAULT_HIGHLIGHT_COLOR : DEFAULT_TEXT_MARKUP_COLOR;
  setColor(fn, annotPtr, draft.color ?? fallback);
  setOpacity(fn, annotPtr, draft.opacity ?? DEFAULT_OPACITY);
}

/**
 * Apply a text-markup patch to an existing annotation. Order:
 *   1. base author-metadata (contents/author; never /NM)
 *   2. color (only if present)
 *   3. opacity (only if present)
 *   4. quadPoints (only if present, AND non-empty — the schema accepts an
 *      empty array but PDFium would treat it as a deletion of the
 *      attachment-point list, which is never the user's intent. We
 *      explicitly reject the empty-array case).
 *
 * `rect` is recomputed only when quadPoints change, to keep /Rect in sync
 * with the smallest enclosing box.
 */
export function applyTextMarkupPatch(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  patch: TextMarkupPatch,
): void {
  applyAnnotationBasePatch(fn, mem, annotPtr, patch);

  if (patch.color !== undefined) {
    setColor(fn, annotPtr, patch.color);
  }
  if (patch.opacity !== undefined) {
    setOpacity(fn, annotPtr, patch.opacity);
  }
  if (patch.quadPoints !== undefined) {
    if (patch.quadPoints.length === 0) {
      throw new EngineError(
        EngineErrorCode.InvalidArg,
        `text-markup patch quadPoints, when present, must be non-empty`,
      );
    }
    replaceQuadPoints(fn, mem, annotPtr, patch.quadPoints);
    setRectFromQuadPoints(fn, mem, annotPtr, patch.quadPoints);
  }
}

/**
 * Type-narrowing predicate. Mirrors the reader-side dispatch. Used by
 * the writer registry to pick the right writer for a draft/patch's
 * `subtype` discriminator.
 */
export function isTextMarkupSubtype(
  subtype: string,
): subtype is 'highlight' | 'underline' | 'squiggly' | 'strikeout' {
  return (
    subtype === 'highlight' ||
    subtype === 'underline' ||
    subtype === 'squiggly' ||
    subtype === 'strikeout'
  );
}

function appendQuadPoints(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  quadPoints: QuadPoint[],
): void {
  const buf = mem.alloc(32);
  try {
    for (const qp of quadPoints) {
      writeQuadPointStruct(mem, buf, qp);
      const ok = fn.FPDFAnnot_AppendAttachmentPoints(annotPtr, buf);
      if (!ok) {
        throw new EngineError(
          EngineErrorCode.Unknown,
          'FPDFAnnot_AppendAttachmentPoints returned false',
        );
      }
    }
  } finally {
    mem.free(buf);
  }
}

/**
 * Replace the existing quadPoints with the supplied list. PDFium has
 * `FPDFAnnot_SetAttachmentPoints` which writes at index, but no truncate
 * helper, so we overwrite as many existing slots as we can and append
 * the rest. PDFium will GROW the list via append, but it cannot SHRINK
 * it; for that reason `applyTextMarkupPatch` rejects an empty patch and
 * the conformance suite covers the "patch must not shrink quadPoints"
 * rule (`patch.quadPoints.length >= existingCount`).
 */
function replaceQuadPoints(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  quadPoints: QuadPoint[],
): void {
  const existing = fn.FPDFAnnot_CountAttachmentPoints(annotPtr);
  if (quadPoints.length < existing) {
    throw new EngineError(
      EngineErrorCode.InvalidArg,
      `text-markup patch cannot shrink quadPoints (have ${existing}, patch supplies ${quadPoints.length})`,
    );
  }

  const buf = mem.alloc(32);
  try {
    for (let i = 0; i < existing; i++) {
      writeQuadPointStruct(mem, buf, quadPoints[i]!);
      const ok = fn.FPDFAnnot_SetAttachmentPoints(annotPtr, i, buf);
      if (!ok) {
        throw new EngineError(
          EngineErrorCode.Unknown,
          `FPDFAnnot_SetAttachmentPoints failed at index ${i}`,
        );
      }
    }
    for (let i = existing; i < quadPoints.length; i++) {
      writeQuadPointStruct(mem, buf, quadPoints[i]!);
      const ok = fn.FPDFAnnot_AppendAttachmentPoints(annotPtr, buf);
      if (!ok) {
        throw new EngineError(
          EngineErrorCode.Unknown,
          `FPDFAnnot_AppendAttachmentPoints failed at index ${i}`,
        );
      }
    }
  } finally {
    mem.free(buf);
  }
}

function writeQuadPointStruct(mem: PdfRuntimeMemory, buf: Ptr, qp: QuadPoint): void {
  // FS_QUADPOINTSF layout per public/fpdf_annot.h: { x1,y1, x2,y2, x3,y3, x4,y4 }
  // (topLeft, topRight, bottomLeft, bottomRight) — same order as readQuadPoints.
  mem.poke(buf, 'f32', qp.topLeft.x, 0);
  mem.poke(buf, 'f32', qp.topLeft.y, 4);
  mem.poke(buf, 'f32', qp.topRight.x, 8);
  mem.poke(buf, 'f32', qp.topRight.y, 12);
  mem.poke(buf, 'f32', qp.bottomLeft.x, 16);
  mem.poke(buf, 'f32', qp.bottomLeft.y, 20);
  mem.poke(buf, 'f32', qp.bottomRight.x, 24);
  mem.poke(buf, 'f32', qp.bottomRight.y, 28);
}

function setRectFromQuadPoints(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  quadPoints: QuadPoint[],
): void {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const qp of quadPoints) {
    for (const p of [qp.topLeft, qp.topRight, qp.bottomLeft, qp.bottomRight]) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  const buf = mem.alloc(16);
  try {
    // FS_RECTF layout: { left, top, right, bottom } (top > bottom in PDF coords).
    mem.poke(buf, 'f32', minX, 0);
    mem.poke(buf, 'f32', maxY, 4);
    mem.poke(buf, 'f32', maxX, 8);
    mem.poke(buf, 'f32', minY, 12);
    fn.FPDFAnnot_SetRect(annotPtr, buf);
  } finally {
    mem.free(buf);
  }
}

function setColor(fn: PdfFunctions, annotPtr: Ptr, color: Color): void {
  const a = Math.max(0, Math.min(255, Math.round((color.a ?? 1) * 255)));
  const ok = fn.FPDFAnnot_SetColor(
    annotPtr,
    FPDFANNOT_COLORTYPE_Color,
    color.r & 0xff,
    color.g & 0xff,
    color.b & 0xff,
    a,
  );
  if (!ok) {
    throw new EngineError(EngineErrorCode.Unknown, 'FPDFAnnot_SetColor returned false');
  }
}

function setOpacity(fn: PdfFunctions, annotPtr: Ptr, opacity: number): void {
  const clamped = Math.max(0, Math.min(1, opacity));
  const ok = fn.EPDFAnnot_SetNumberValue(annotPtr, 'CA', clamped);
  if (!ok) {
    throw new EngineError(EngineErrorCode.Unknown, 'EPDFAnnot_SetNumberValue(/CA) returned false');
  }
}
