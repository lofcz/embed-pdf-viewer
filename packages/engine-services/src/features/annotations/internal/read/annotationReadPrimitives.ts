import type { AnnotationFlags, Color, PdfQuad, PdfRect } from '@embedpdf/engine-core/runtime';
import { NO_ANNOTATION_FLAGS } from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import { withScratch, withScratchN } from '../../../../runtime/memory/scratch';
import { readUtf16String } from '../../../../runtime/memory/strings';
import {
  F32_BYTES,
  I32_BYTES,
  QUADPOINTSF_BYTES,
  RECTF_BYTES,
  readF32,
  readI32,
  readRectF,
} from '../../../../runtime/memory/structs';

/**
 * Reads a UTF-16 string entry from an annotation dictionary. Returns
 * `null` if the key is not present, otherwise the (possibly empty) string.
 */
export function readAnnotString(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  key: string,
): string | null {
  if (!fn.FPDFAnnot_HasKey(annotPtr, key)) return null;
  return readUtf16String(
    mem,
    (buf, capacity) => fn.FPDFAnnot_GetStringValue(annotPtr, key, buf, capacity),
    '',
  );
}

/**
 * Read /Rect from an annot dict via FPDFAnnot_GetRect.
 * FS_RECTF layout: { float left, top, right, bottom } -> 16 bytes.
 */
export function readAnnotRect(fn: PdfFunctions, mem: PdfRuntimeMemory, annotPtr: Ptr): PdfRect {
  return withScratch(mem, RECTF_BYTES, (buf) => {
    if (!fn.FPDFAnnot_GetRect(annotPtr, buf)) {
      return { left: 0, bottom: 0, right: 0, top: 0 };
    }
    return readRectF(mem, buf);
  });
}

const ANNOT_FLAG_BITS = {
  invisible: 1 << 0,
  hidden: 1 << 1,
  print: 1 << 2,
  noZoom: 1 << 3,
  noRotate: 1 << 4,
  noView: 1 << 5,
  readOnly: 1 << 6,
  locked: 1 << 7,
  toggleNoView: 1 << 8,
  lockedContents: 1 << 9,
} as const satisfies Record<keyof AnnotationFlags, number>;

export function readAnnotFlags(fn: PdfFunctions, annotPtr: Ptr): AnnotationFlags {
  const bits = fn.FPDFAnnot_GetFlags(annotPtr);
  if (bits === 0) return { ...NO_ANNOTATION_FLAGS };
  return {
    invisible: (bits & ANNOT_FLAG_BITS.invisible) !== 0,
    hidden: (bits & ANNOT_FLAG_BITS.hidden) !== 0,
    print: (bits & ANNOT_FLAG_BITS.print) !== 0,
    noZoom: (bits & ANNOT_FLAG_BITS.noZoom) !== 0,
    noRotate: (bits & ANNOT_FLAG_BITS.noRotate) !== 0,
    noView: (bits & ANNOT_FLAG_BITS.noView) !== 0,
    readOnly: (bits & ANNOT_FLAG_BITS.readOnly) !== 0,
    locked: (bits & ANNOT_FLAG_BITS.locked) !== 0,
    toggleNoView: (bits & ANNOT_FLAG_BITS.toggleNoView) !== 0,
    lockedContents: (bits & ANNOT_FLAG_BITS.lockedContents) !== 0,
  };
}

/**
 * /Color via FPDFAnnot_GetColor. PDF colors come back as 0..255 ints
 * for each channel. Alpha is reported by PDFium as the same channel.
 *
 * Returns `null` if the annotation has no /C entry. Opacity is read
 * separately via FPDFAnnot_GetNumberValue('CA').
 */
export function readAnnotColor(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  type: number = 0, // FPDFANNOT_COLORTYPE_Color
): Color | null {
  return withScratchN(mem, [I32_BYTES, I32_BYTES, I32_BYTES, I32_BYTES], ([r, g, b, a]) => {
    if (!fn.FPDFAnnot_GetColor(annotPtr, type, r, g, b, a)) return null;
    return {
      r: readI32(mem, r) & 0xff,
      g: readI32(mem, g) & 0xff,
      b: readI32(mem, b) & 0xff,
      a: (readI32(mem, a) & 0xff) / 255,
    };
  });
}

/**
 * Read a numeric value from an annotation dict (e.g. /CA opacity).
 * Returns `null` when the key is absent or not a number.
 */
export function readAnnotNumber(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  key: string,
): number | null {
  return withScratch(mem, F32_BYTES, (buf) => {
    if (!fn.FPDFAnnot_GetNumberValue(annotPtr, key, buf)) return null;
    return readF32(mem, buf);
  });
}

/**
 * Read attachment points for a text-markup annotation.
 * Each `FS_QUADPOINTSF` is 8 floats = 32 bytes.
 */
export function readQuadPoints(fn: PdfFunctions, mem: PdfRuntimeMemory, annotPtr: Ptr): PdfQuad[] {
  const count = fn.FPDFAnnot_CountAttachmentPoints(annotPtr);
  if (count <= 0) return [];

  return withScratch(mem, QUADPOINTSF_BYTES, (buf) => {
    const out: PdfQuad[] = [];
    for (let i = 0; i < count; i++) {
      if (!fn.FPDFAnnot_GetAttachmentPoints(annotPtr, i, buf)) continue;
      const f = (off: number) => readF32(mem, buf, off);
      // Positional, in PDFium FS_QUADPOINTSF slot order (PDF 32000 12.5.6.10):
      // { x1,y1, x2,y2, x3,y3, x4,y4 } -> p1 p2 p3 p4. We do NOT relabel these
      // as named corners: PdfQuad asserts no corner semantics (see its docs).
      out.push({
        p1: { x: f(0), y: f(4) },
        p2: { x: f(8), y: f(12) },
        p3: { x: f(16), y: f(20) },
        p4: { x: f(24), y: f(28) },
      });
    }
    return out;
  });
}
