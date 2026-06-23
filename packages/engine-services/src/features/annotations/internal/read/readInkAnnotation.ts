import type { AnnotationBase, InkAnnotationDTO } from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import { readInkList } from './annotationReadPrimitives';
import { readGeometryStyleExtras } from './readStyle';

export function readInk(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  base: AnnotationBase,
): InkAnnotationDTO {
  return {
    ...base,
    subtype: 'ink',
    ...readGeometryStyleExtras(fn, mem, annotPtr),
    inkList: readInkList(fn, mem, annotPtr),
  };
}
