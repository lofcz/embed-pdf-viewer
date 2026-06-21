import type {
  AnnotationBase,
  CircleAnnotationDTO,
  Color,
  ShapeAnnotationFields,
  SquareAnnotationDTO,
} from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import { FPDFANNOT_COLORTYPE } from '../colorType';
import { borderStyleFromCode } from '../shapeBorderStyle';
import {
  readAnnotColor,
  readAnnotOpacity,
  readBorderDashPattern,
  readBorderEffect,
  readBorderStyle,
  readRectangleDifferences,
} from './annotationReadPrimitives';

/**
 * Default stroke colour when a shape has no `/C`. Matches the v2 engine
 * (`readPdfCircleAnno`/`readPdfSquareAnno` default red).
 */
const DEFAULT_SHAPE_STROKE_COLOR: Color = { r: 255, g: 0, b: 0 };

/**
 * Shared reader for the two shape subtypes. Materialises interior/stroke
 * colour, opacity, border style/width, and the optional dash/cloudy/RD
 * fields; the caller fills in the `subtype` literal.
 */
export function readShapeExtras(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
): ShapeAnnotationFields {
  const interiorColor = readAnnotColor(fn, mem, annotPtr, FPDFANNOT_COLORTYPE.InteriorColor);
  const strokeColor = readAnnotColor(fn, mem, annotPtr, FPDFANNOT_COLORTYPE.Color) ?? {
    ...DEFAULT_SHAPE_STROKE_COLOR,
  };
  const ca = readAnnotOpacity(fn, mem, annotPtr);
  const opacity = ca == null ? 1 : Math.max(0, Math.min(1, ca));
  const { styleCode, width } = readBorderStyle(fn, mem, annotPtr);
  const dashArray = readBorderDashPattern(fn, mem, annotPtr);
  const cloudyIntensity = readBorderEffect(fn, mem, annotPtr);
  const rectDifferences = readRectangleDifferences(fn, mem, annotPtr);

  return {
    interiorColor: interiorColor ?? null,
    strokeColor,
    strokeWidth: width,
    borderStyle: borderStyleFromCode(styleCode),
    opacity,
    ...(dashArray.length > 0 ? { dashArray } : {}),
    ...(cloudyIntensity != null ? { cloudyIntensity } : {}),
    ...(rectDifferences ? { rectDifferences } : {}),
  };
}

export function readCircle(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  base: AnnotationBase,
): CircleAnnotationDTO {
  return { ...base, subtype: 'circle', ...readShapeExtras(fn, mem, annotPtr) };
}

export function readSquare(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  base: AnnotationBase,
): SquareAnnotationDTO {
  return { ...base, subtype: 'square', ...readShapeExtras(fn, mem, annotPtr) };
}
