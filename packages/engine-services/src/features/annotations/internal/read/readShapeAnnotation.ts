import type {
  AnnotationBase,
  CircleAnnotationDTO,
  ShapeAnnotationFields,
  SquareAnnotationDTO,
} from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import { readBorderEffect, readRectangleDifferences } from './annotationReadPrimitives';
import { readFilledStyleExtras } from './readStyle';

/**
 * Shared reader for the two shape subtypes. Materialises the common
 * stroke/fill styling plus the shape-only cloudy (`/BE`) and rect-diff
 * (`/RD`) fields; the caller fills in the `subtype` literal.
 */
export function readShapeExtras(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
): ShapeAnnotationFields {
  const cloudyIntensity = readBorderEffect(fn, mem, annotPtr);
  const rectDifferences = readRectangleDifferences(fn, mem, annotPtr);

  return {
    ...readFilledStyleExtras(fn, mem, annotPtr),
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
