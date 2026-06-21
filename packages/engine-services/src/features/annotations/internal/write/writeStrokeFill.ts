import { type Color, type StrokeFillDraftFields } from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import { FPDFANNOT_COLORTYPE } from '../colorType';
import { readBorderStyle } from '../read/annotationReadPrimitives';
import { borderStyleFromCode, borderStyleToCode } from '../shapeBorderStyle';
import {
  clearAnnotColor,
  setAnnotColor,
  setAnnotOpacity,
  setBorderDashPattern,
  setBorderStyle,
} from './annotationWritePrimitives';

/**
 * Defaults applied when a draft omits a stroke/fill field. Shared by every
 * geometric family (shape/vertex/line) so circle, square, polygon,
 * polyline, and line all default to a 1pt solid red stroke with no fill.
 */
export const DEFAULT_OPACITY = 1;
export const DEFAULT_STROKE_WIDTH = 1;
export const DEFAULT_STROKE_COLOR: Color = { r: 255, g: 0, b: 0 };

/**
 * Apply the common stroke/fill styling (`/IC`, `/C`, `/CA`, `/BS`, dash)
 * from a draft to a freshly-created annotation. Geometry (`/Rect`,
 * `/Vertices`, `/L`), cloudy borders, rect-differences, and line endings
 * are layered on by the family-specific writer around this call.
 *
 * Interior colour: a `null`/omitted fill clears `/IC` so the shape renders
 * unfilled.
 */
export function applyStrokeFillDraft(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  draft: StrokeFillDraftFields,
): void {
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
}

/**
 * Apply the common stroke/fill styling from a patch to an existing
 * annotation. Only present fields are touched. Border style + width share
 * the single `EPDFAnnot_SetBorderStyle` call, so when only one is patched
 * we read the current pair first and preserve the other.
 */
export function applyStrokeFillPatch(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  patch: StrokeFillDraftFields,
): void {
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
}
