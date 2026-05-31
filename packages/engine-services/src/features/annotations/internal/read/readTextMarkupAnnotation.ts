import type {
  AnnotationBase,
  Color,
  HighlightAnnotationDTO,
  QuadPoint,
  SquigglyAnnotationDTO,
  StrikeoutAnnotationDTO,
  UnderlineAnnotationDTO,
} from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import { readAnnotColor, readAnnotNumber, readQuadPoints } from './annotationReadPrimitives';

const DEFAULT_HIGHLIGHT_COLOR: Color = { r: 255, g: 255, b: 0 };
const DEFAULT_TEXT_MARKUP_COLOR: Color = { r: 0, g: 0, b: 0 };

/**
 * Shared reader for the four text-markup subtypes. Wires color, opacity,
 * and quadPoints; the caller fills in the `subtype` literal so the
 * result matches the requested DTO shape.
 */
export function readTextMarkupExtras(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  fallbackColor: Color = DEFAULT_TEXT_MARKUP_COLOR,
): {
  color: Color;
  opacity: number;
  quadPoints: QuadPoint[];
} {
  const color = readAnnotColor(fn, mem, annotPtr) ?? { ...fallbackColor };
  const ca = readAnnotNumber(fn, mem, annotPtr, 'CA');
  const opacity = ca == null ? 1 : Math.max(0, Math.min(1, ca));
  const quadPoints = readQuadPoints(fn, mem, annotPtr);
  return { color, opacity, quadPoints };
}

export function readHighlight(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  base: AnnotationBase,
): HighlightAnnotationDTO {
  const extras = readTextMarkupExtras(fn, mem, annotPtr, DEFAULT_HIGHLIGHT_COLOR);
  return { ...base, subtype: 'highlight', ...extras };
}

export function readUnderline(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  base: AnnotationBase,
): UnderlineAnnotationDTO {
  const extras = readTextMarkupExtras(fn, mem, annotPtr);
  return { ...base, subtype: 'underline', ...extras };
}

export function readSquiggly(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  base: AnnotationBase,
): SquigglyAnnotationDTO {
  const extras = readTextMarkupExtras(fn, mem, annotPtr);
  return { ...base, subtype: 'squiggly', ...extras };
}

export function readStrikeout(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  base: AnnotationBase,
): StrikeoutAnnotationDTO {
  const extras = readTextMarkupExtras(fn, mem, annotPtr);
  return { ...base, subtype: 'strikeout', ...extras };
}
