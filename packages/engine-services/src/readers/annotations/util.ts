import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';
import { NULL_PTR } from '@embedpdf/pdf-runtime';
import type { AnnotationFlags, Color, QuadPoint, Rect } from '@embedpdf/engine-core/runtime';
import { NO_ANNOTATION_FLAGS } from '@embedpdf/engine-core/runtime';

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
  const len = fn.FPDFAnnot_GetStringValue(annotPtr, key, NULL_PTR, 0);
  if (len <= 0) return null;
  if (len === 2) return '';

  const buf = mem.alloc(len);
  try {
    const written = fn.FPDFAnnot_GetStringValue(annotPtr, key, buf, len);
    if (written <= 0) return null;
    return mem.readU16String(buf);
  } finally {
    mem.free(buf);
  }
}

/**
 * Read /Rect from an annot dict via FPDFAnnot_GetRect.
 * FS_RECTF layout: { float left, top, right, bottom } -> 16 bytes.
 */
export function readAnnotRect(fn: PdfFunctions, mem: PdfRuntimeMemory, annotPtr: Ptr): Rect {
  const buf = mem.alloc(16);
  try {
    const ok = fn.FPDFAnnot_GetRect(annotPtr, buf);
    if (!ok) {
      return { left: 0, top: 0, right: 0, bottom: 0 };
    }
    return {
      left: Number(mem.peek(buf, 'f32', 0)),
      top: Number(mem.peek(buf, 'f32', 4)),
      right: Number(mem.peek(buf, 'f32', 8)),
      bottom: Number(mem.peek(buf, 'f32', 12)),
    };
  } finally {
    mem.free(buf);
  }
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
  const r = mem.alloc(4);
  const g = mem.alloc(4);
  const b = mem.alloc(4);
  const a = mem.alloc(4);
  try {
    const ok = fn.FPDFAnnot_GetColor(annotPtr, type, r, g, b, a);
    if (!ok) return null;
    return {
      r: Number(mem.peek(r, 'i32')) & 0xff,
      g: Number(mem.peek(g, 'i32')) & 0xff,
      b: Number(mem.peek(b, 'i32')) & 0xff,
      a: (Number(mem.peek(a, 'i32')) & 0xff) / 255,
    };
  } finally {
    mem.free(r);
    mem.free(g);
    mem.free(b);
    mem.free(a);
  }
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
  const buf = mem.alloc(4);
  try {
    const ok = fn.FPDFAnnot_GetNumberValue(annotPtr, key, buf);
    if (!ok) return null;
    return Number(mem.peek(buf, 'f32'));
  } finally {
    mem.free(buf);
  }
}

/**
 * Read attachment points for a text-markup annotation.
 * Each `FS_QUADPOINTSF` is 8 floats = 32 bytes.
 */
export function readQuadPoints(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
): QuadPoint[] {
  const count = fn.FPDFAnnot_CountAttachmentPoints(annotPtr);
  if (count <= 0) return [];

  const buf = mem.alloc(32);
  const out: QuadPoint[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const ok = fn.FPDFAnnot_GetAttachmentPoints(annotPtr, i, buf);
      if (!ok) continue;
      const f = (off: number) => Number(mem.peek(buf, 'f32', off));
      // Layout per PDF 32000 12.5.6.10: { x1,y1, x2,y2, x3,y3, x4,y4 }
      // where (x1,y1)=topLeft, (x2,y2)=topRight, (x3,y3)=bottomLeft, (x4,y4)=bottomRight
      out.push({
        topLeft: { x: f(0), y: f(4) },
        topRight: { x: f(8), y: f(12) },
        bottomLeft: { x: f(16), y: f(20) },
        bottomRight: { x: f(24), y: f(28) },
      });
    }
  } finally {
    mem.free(buf);
  }
  return out;
}
