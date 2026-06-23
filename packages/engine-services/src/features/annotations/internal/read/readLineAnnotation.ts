import type { AnnotationBase, LineAnnotationDTO } from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import { readLine as readLinePoints, readLineEndings } from './annotationReadPrimitives';
import { readFilledStyleExtras } from './readStyle';

/** Fallback `/L` when the annotation has no line geometry. */
const ZERO_LINE = { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } };

export function readLine(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  base: AnnotationBase,
): LineAnnotationDTO {
  return {
    ...base,
    subtype: 'line',
    ...readFilledStyleExtras(fn, mem, annotPtr),
    linePoints: readLinePoints(fn, mem, annotPtr) ?? ZERO_LINE,
    lineEndings: readLineEndings(fn, mem, annotPtr),
  };
}
