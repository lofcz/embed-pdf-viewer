import {
  EngineError,
  EngineErrorCode,
  type Color,
  type PdfRect,
  type PdfRectDifferences,
} from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import { F32_BYTES, RECTF_BYTES } from '../../../../runtime/memory/structs';
import { FPDFANNOT_COLORTYPE } from '../colorType';

/**
 * Write-side twin of `annotationReadPrimitives.ts`. Every annotation
 * family (text-markup, shape, and upcoming polygon/polyline/line/free-text)
 * composes these low-level setters so the PDFium FFI surface lives in one
 * place. All colour/opacity/border writes go through the EmbedPDF
 * `EPDFAnnot_*` extensions — the same path v2 used and the read primitives
 * read back — so values survive native `EPDFAnnot_GenerateAppearance`.
 */

/**
 * Set an annotation colour via the EmbedPDF `EPDFAnnot_SetColor`
 * extension. The `type` arg (FPDFANNOT_COLORTYPE) selects which colour to
 * write — `Color` is the stroke/fill `/C`, `InteriorColor` is the `/IC`
 * of square/circle/polygon. RGB only; annotation opacity lives in `/CA`
 * (see {@link setAnnotOpacity}), not a per-colour alpha. The stock
 * `FPDFAnnot_SetColor` cannot author interior colour, which is why we use
 * the extension uniformly.
 */
export function setAnnotColor(
  fn: PdfFunctions,
  annotPtr: Ptr,
  color: Color,
  type: number = FPDFANNOT_COLORTYPE.Color,
): void {
  const ok = fn.EPDFAnnot_SetColor(annotPtr, type, color.r & 0xff, color.g & 0xff, color.b & 0xff);
  if (!ok) {
    throw new EngineError(EngineErrorCode.Unknown, 'EPDFAnnot_SetColor returned false');
  }
}

/**
 * Remove an annotation colour entry via `EPDFAnnot_ClearColor` (e.g. a
 * transparent fill clears `/IC`). A false return is benign — there was no
 * entry to clear — so we don't treat it as an error.
 */
export function clearAnnotColor(fn: PdfFunctions, annotPtr: Ptr, type: number): void {
  fn.EPDFAnnot_ClearColor(annotPtr, type);
}

/**
 * Set annotation opacity (`/CA`) via the dedicated `EPDFAnnot_SetOpacity`
 * extension. Input is 0..1; the native alpha is 0..255. This is the path
 * that stores `/CA` in the form native appearance generation expects, so
 * opacity survives the bake.
 */
export function setAnnotOpacity(fn: PdfFunctions, annotPtr: Ptr, opacity: number): void {
  const alpha = Math.max(0, Math.min(255, Math.round(opacity * 255)));
  if (!fn.EPDFAnnot_SetOpacity(annotPtr, alpha)) {
    throw new EngineError(EngineErrorCode.Unknown, 'EPDFAnnot_SetOpacity returned false');
  }
}

/**
 * Write `/Rect` via `FPDFAnnot_SetRect`. FS_RECTF layout is
 * `{ left, top, right, bottom }` (top > bottom in PDF coords).
 */
export function setAnnotRect(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  rect: PdfRect,
): void {
  const buf = mem.alloc(RECTF_BYTES);
  try {
    mem.poke(buf, 'f32', rect.left, 0);
    mem.poke(buf, 'f32', rect.top, 4);
    mem.poke(buf, 'f32', rect.right, 8);
    mem.poke(buf, 'f32', rect.bottom, 12);
    if (!fn.FPDFAnnot_SetRect(annotPtr, buf)) {
      throw new EngineError(EngineErrorCode.Unknown, 'FPDFAnnot_SetRect returned false');
    }
  } finally {
    mem.free(buf);
  }
}

/**
 * Set `/BS /S` (border style code) and `/BS /W` (width) in one call via
 * `EPDFAnnot_SetBorderStyle`. `styleCode` is a raw
 * `FPDF_ANNOT_BORDER_STYLE` enum value — the string<->code mapping lives
 * in `shapeBorderStyle.ts` so engine-core stays PDFium-free.
 */
export function setBorderStyle(
  fn: PdfFunctions,
  annotPtr: Ptr,
  styleCode: number,
  width: number,
): void {
  if (!fn.EPDFAnnot_SetBorderStyle(annotPtr, styleCode, width)) {
    throw new EngineError(EngineErrorCode.Unknown, 'EPDFAnnot_SetBorderStyle returned false');
  }
}

/**
 * Write the dashed-border pattern (`/BS /D`) via
 * `EPDFAnnot_SetBorderDashPattern`. Each entry is clamped to >= 0.
 */
export function setBorderDashPattern(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  dashArray: number[],
): void {
  const buf = mem.alloc(dashArray.length * F32_BYTES);
  try {
    for (let i = 0; i < dashArray.length; i++) {
      mem.poke(buf, 'f32', Math.max(0, dashArray[i]!), i * F32_BYTES);
    }
    if (!fn.EPDFAnnot_SetBorderDashPattern(annotPtr, buf, dashArray.length)) {
      throw new EngineError(
        EngineErrorCode.Unknown,
        'EPDFAnnot_SetBorderDashPattern returned false',
      );
    }
  } finally {
    mem.free(buf);
  }
}

/** Set the `/BE` cloudy border effect intensity. */
export function setBorderEffect(fn: PdfFunctions, annotPtr: Ptr, intensity: number): void {
  if (!fn.EPDFAnnot_SetBorderEffect(annotPtr, intensity)) {
    throw new EngineError(EngineErrorCode.Unknown, 'EPDFAnnot_SetBorderEffect returned false');
  }
}

/**
 * Remove the `/BE` cloudy border effect. A false return is benign (there
 * was no effect to clear), so we don't treat it as an error.
 */
export function clearBorderEffect(fn: PdfFunctions, annotPtr: Ptr): void {
  fn.EPDFAnnot_ClearBorderEffect(annotPtr);
}

/**
 * Write `/RD` rectangle differences via
 * `EPDFAnnot_SetRectangleDifferences`. PDFium core stores `/RD` as
 * `[left, bottom, right, top]`; we accept the wire-stable
 * `{ left, top, right, bottom }` shape and reorder at the boundary.
 */
export function setRectangleDifferences(
  fn: PdfFunctions,
  annotPtr: Ptr,
  rd: PdfRectDifferences,
): void {
  if (!fn.EPDFAnnot_SetRectangleDifferences(annotPtr, rd.left, rd.bottom, rd.right, rd.top)) {
    throw new EngineError(
      EngineErrorCode.Unknown,
      'EPDFAnnot_SetRectangleDifferences returned false',
    );
  }
}

/**
 * Remove the `/RD` rectangle-differences entry. A false return is benign
 * (there was no entry to clear), so we don't treat it as an error.
 */
export function clearRectangleDifferences(fn: PdfFunctions, annotPtr: Ptr): void {
  fn.EPDFAnnot_ClearRectangleDifferences(annotPtr);
}
