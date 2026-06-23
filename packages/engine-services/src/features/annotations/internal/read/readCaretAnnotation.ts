import type { AnnotationBase, CaretAnnotationDTO, Color } from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import {
  readAnnotColor,
  readAnnotOpacity,
  readRectangleDifferences,
} from './annotationReadPrimitives';

/** Default `/C` colour when a caret has none (matches the writer default). */
const DEFAULT_CARET_COLOR: Color = { r: 255, g: 0, b: 0 };

export function readCaret(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  base: AnnotationBase,
): CaretAnnotationDTO {
  const color = readAnnotColor(fn, mem, annotPtr) ?? { ...DEFAULT_CARET_COLOR };
  const ca = readAnnotOpacity(fn, mem, annotPtr);
  const opacity = ca == null ? 1 : Math.max(0, Math.min(1, ca));
  const rd = readRectangleDifferences(fn, mem, annotPtr);

  return {
    ...base,
    subtype: 'caret',
    color,
    opacity,
    ...(rd !== null ? { rectDifferences: rd } : {}),
  };
}
