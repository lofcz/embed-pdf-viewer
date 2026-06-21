import type {
  AnnotationFlags,
  Color,
  PdfQuad,
  PdfRect,
  PdfRectDifferences,
} from '@embedpdf/engine-core/runtime';
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
 * Read an annotation color via the EmbedPDF `EPDFAnnot_GetColor`
 * extension. The `type` arg (FPDFANNOT_COLORTYPE) selects which color to
 * read — `0` (default) is the stroke/fill `/C`, `1` is the interior `/IC`
 * of square/circle/polygon annotations. Unlike the stock
 * `FPDFAnnot_GetColor`, the extension exposes interior color. Returns RGB
 * only — annotation opacity lives in `/CA`, not a per-color alpha.
 *
 * Returns `null` when the requested color entry is absent.
 */
export function readAnnotColor(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  type: number = 0, // FPDFANNOT_COLORTYPE_Color
): Color | null {
  return withScratchN(mem, [I32_BYTES, I32_BYTES, I32_BYTES], ([r, g, b]) => {
    if (!fn.EPDFAnnot_GetColor(annotPtr, type, r, g, b)) return null;
    return {
      r: readI32(mem, r) & 0xff,
      g: readI32(mem, g) & 0xff,
      b: readI32(mem, b) & 0xff,
    };
  });
}

/**
 * Read annotation opacity via the EmbedPDF `EPDFAnnot_GetOpacity`
 * extension. Returns a 0..1 value (the native alpha is 0..255). Returns
 * `null` when the annotation has no opacity entry. This is the path that
 * stays consistent across native `EPDFAnnot_GenerateAppearance`, unlike a
 * raw `/CA` number read.
 */
export function readAnnotOpacity(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
): number | null {
  return withScratch(mem, I32_BYTES, (buf) => {
    if (!fn.EPDFAnnot_GetOpacity(annotPtr, buf)) return null;
    return (readI32(mem, buf) & 0xff) / 255;
  });
}

/**
 * Read the `/BS /S` border style code and `/BS /W` border width via
 * `EPDFAnnot_GetBorderStyle`. The return value is the raw
 * `FPDF_ANNOT_BORDER_STYLE` enum code; the width is written into the
 * scratch out-parameter. Style/width string mapping lives in the shape
 * reader (engine-core stays PDFium-free).
 */
export function readBorderStyle(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
): { styleCode: number; width: number } {
  return withScratch(mem, F32_BYTES, (buf) => {
    const styleCode = fn.EPDFAnnot_GetBorderStyle(annotPtr, buf);
    return { styleCode, width: readF32(mem, buf) };
  });
}

/**
 * Read the dash pattern of a dashed border. Returns an empty array when
 * the border is not dashed or has no `/BS /D` entry.
 */
export function readBorderDashPattern(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
): number[] {
  const count = fn.EPDFAnnot_GetBorderDashPatternCount(annotPtr);
  if (count <= 0) return [];
  return withScratch(mem, count * F32_BYTES, (buf) => {
    if (!fn.EPDFAnnot_GetBorderDashPattern(annotPtr, buf, count)) return [];
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(readF32(mem, buf, i * F32_BYTES));
    return out;
  });
}

/**
 * Read the `/BE` cloudy border intensity. Returns `null` when the
 * annotation has no cloudy border effect.
 */
export function readBorderEffect(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
): number | null {
  return withScratch(mem, F32_BYTES, (buf) => {
    if (!fn.EPDFAnnot_GetBorderEffect(annotPtr, buf)) return null;
    return readF32(mem, buf);
  });
}

/**
 * Read the `/RD` rectangle differences. Returns `null` when the
 * annotation has no `/RD` entry. PDFium reports `/RD` in
 * `[left, bottom, right, top]` order; we surface the wire-stable
 * `{ left, top, right, bottom }` shape.
 */
export function readRectangleDifferences(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
): PdfRectDifferences | null {
  return withScratchN(
    mem,
    [F32_BYTES, F32_BYTES, F32_BYTES, F32_BYTES],
    ([left, bottom, right, top]) => {
      if (!fn.EPDFAnnot_GetRectangleDifferences(annotPtr, left, bottom, right, top)) return null;
      return {
        left: readF32(mem, left),
        bottom: readF32(mem, bottom),
        right: readF32(mem, right),
        top: readF32(mem, top),
      };
    },
  );
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
