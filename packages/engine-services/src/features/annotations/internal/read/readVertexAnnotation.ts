import type {
  AnnotationBase,
  PolygonAnnotationDTO,
  PolylineAnnotationDTO,
  VertexAnnotationFields,
} from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import {
  readBorderEffect,
  readLineEndings,
  readRectangleDifferences,
  readVertices,
} from './annotationReadPrimitives';
import { readStrokeFillExtras } from './readStrokeFill';

/**
 * Shared reader for the two vertex subtypes (polygon/polyline). Reads the
 * common stroke/fill styling plus the `/Vertices` point list; each caller
 * layers its own subtype-specific extras (polygon: cloudy + RD; polyline:
 * line endings) and the `subtype` literal.
 */
export function readVertexExtras(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
): VertexAnnotationFields {
  return {
    ...readStrokeFillExtras(fn, mem, annotPtr),
    vertices: readVertices(fn, mem, annotPtr),
  };
}

export function readPolygon(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  base: AnnotationBase,
): PolygonAnnotationDTO {
  const cloudyIntensity = readBorderEffect(fn, mem, annotPtr);
  const rectDifferences = readRectangleDifferences(fn, mem, annotPtr);
  return {
    ...base,
    subtype: 'polygon',
    ...readVertexExtras(fn, mem, annotPtr),
    ...(cloudyIntensity != null ? { cloudyIntensity } : {}),
    ...(rectDifferences ? { rectDifferences } : {}),
  };
}

export function readPolyline(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  base: AnnotationBase,
): PolylineAnnotationDTO {
  return {
    ...base,
    subtype: 'polyline',
    ...readVertexExtras(fn, mem, annotPtr),
    lineEndings: readLineEndings(fn, mem, annotPtr),
  };
}
