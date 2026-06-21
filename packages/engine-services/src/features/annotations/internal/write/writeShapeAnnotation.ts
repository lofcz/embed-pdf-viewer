import {
  type CircleDraft,
  type CirclePatch,
  type Color,
  type SquareDraft,
  type SquarePatch,
} from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import { FPDFANNOT_COLORTYPE } from '../colorType';
import {
  clearAnnotColor,
  clearBorderEffect,
  setAnnotColor,
  setAnnotOpacity,
  setAnnotRect,
  setBorderDashPattern,
  setBorderEffect,
  setBorderStyle,
  setRectangleDifferences,
} from './annotationWritePrimitives';
import { applyAnnotationBaseDraft, applyAnnotationBasePatch } from './writeAnnotationBase';
import { readBorderStyle } from '../read/annotationReadPrimitives';
import { borderStyleToCode, borderStyleFromCode } from '../shapeBorderStyle';

/** Defaults when a draft omits a shape field. */
const DEFAULT_OPACITY = 1;
const DEFAULT_STROKE_WIDTH = 1;
const DEFAULT_STROKE_COLOR: Color = { r: 255, g: 0, b: 0 };

export type ShapeDraft = CircleDraft | SquareDraft;
export type ShapePatch = CirclePatch | SquarePatch;

/**
 * Apply a shape draft to a freshly-created annotation. Caller is
 * responsible for `EPDFPage_CreateAnnot`; this function only writes
 * fields. Order:
 *   1. base author-metadata (contents/nm)
 *   2. /Rect (required — shapes carry their geometry as /Rect, not quads)
 *   3. interior color (/IC; cleared when null/omitted)
 *   4. stroke color (/C)
 *   5. opacity (/CA)
 *   6. border style + width (/BS)
 *   7. optional dash (/BS /D), cloudy (/BE), rect-diff (/RD)
 */
export function applyShapeDraft(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  draft: ShapeDraft,
): void {
  applyAnnotationBaseDraft(fn, mem, annotPtr, draft);

  setAnnotRect(fn, mem, annotPtr, draft.rect);

  const interior = draft.interiorColor ?? null;
  if (interior === null) {
    clearAnnotColor(fn, annotPtr, FPDFANNOT_COLORTYPE.InteriorColor);
  } else {
    setAnnotColor(fn, annotPtr, interior, FPDFANNOT_COLORTYPE.InteriorColor);
  }
  setAnnotColor(fn, annotPtr, draft.strokeColor ?? DEFAULT_STROKE_COLOR);
  setAnnotOpacity(fn, annotPtr, draft.opacity ?? DEFAULT_OPACITY);
  setBorderStyle(
    fn,
    annotPtr,
    borderStyleToCode(draft.borderStyle ?? 'solid'),
    draft.strokeWidth ?? DEFAULT_STROKE_WIDTH,
  );

  if (draft.dashArray !== undefined && draft.dashArray.length > 0) {
    setBorderDashPattern(fn, mem, annotPtr, draft.dashArray);
  }
  if (draft.cloudyIntensity !== undefined && draft.cloudyIntensity > 0) {
    setBorderEffect(fn, annotPtr, draft.cloudyIntensity);
  }
  if (draft.rectDifferences !== undefined) {
    setRectangleDifferences(fn, annotPtr, draft.rectDifferences);
  }
}

/**
 * Apply a shape patch to an existing annotation. Only fields present on
 * the patch are touched. Border style and width share the single PDFium
 * `EPDFAnnot_SetBorderStyle` call, so when only one of them is patched we
 * read the current pair first and preserve the other.
 */
export function applyShapePatch(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  patch: ShapePatch,
): void {
  applyAnnotationBasePatch(fn, mem, annotPtr, patch);

  if (patch.rect !== undefined) {
    setAnnotRect(fn, mem, annotPtr, patch.rect);
  }
  if (patch.interiorColor !== undefined) {
    if (patch.interiorColor === null) {
      clearAnnotColor(fn, annotPtr, FPDFANNOT_COLORTYPE.InteriorColor);
    } else {
      setAnnotColor(fn, annotPtr, patch.interiorColor, FPDFANNOT_COLORTYPE.InteriorColor);
    }
  }
  if (patch.strokeColor !== undefined) {
    setAnnotColor(fn, annotPtr, patch.strokeColor);
  }
  if (patch.opacity !== undefined) {
    setAnnotOpacity(fn, annotPtr, patch.opacity);
  }
  if (patch.borderStyle !== undefined || patch.strokeWidth !== undefined) {
    const current = readBorderStyle(fn, mem, annotPtr);
    const style = patch.borderStyle ?? borderStyleFromCode(current.styleCode);
    const width = patch.strokeWidth ?? current.width;
    setBorderStyle(fn, annotPtr, borderStyleToCode(style), width);
  }
  if (patch.dashArray !== undefined && patch.dashArray.length > 0) {
    setBorderDashPattern(fn, mem, annotPtr, patch.dashArray);
  }
  if (patch.cloudyIntensity !== undefined) {
    if (patch.cloudyIntensity > 0) {
      setBorderEffect(fn, annotPtr, patch.cloudyIntensity);
    } else {
      clearBorderEffect(fn, annotPtr);
    }
  }
  if (patch.rectDifferences !== undefined) {
    setRectangleDifferences(fn, annotPtr, patch.rectDifferences);
  }
}

/**
 * Type-narrowing predicate. Mirrors the reader-side dispatch. Used by the
 * writer registry to pick the shape writer for a draft/patch's `subtype`.
 */
export function isShapeSubtype(subtype: string): subtype is 'circle' | 'square' {
  return subtype === 'circle' || subtype === 'square';
}
