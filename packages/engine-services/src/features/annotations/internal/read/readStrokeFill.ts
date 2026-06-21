import type { Color, StrokeFillFields } from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import { FPDFANNOT_COLORTYPE } from '../colorType';
import { borderStyleFromCode } from '../shapeBorderStyle';
import {
  readAnnotColor,
  readAnnotOpacity,
  readBorderDashPattern,
  readBorderStyle,
} from './annotationReadPrimitives';

/**
 * Default stroke colour when an annotation has no `/C`. Matches the v2
 * engine (circle/square/polygon/polyline/line all default red).
 */
const DEFAULT_STROKE_COLOR: Color = { r: 255, g: 0, b: 0 };

/**
 * Shared reader for the common stroke/fill styling (`/IC`, `/C`, `/CA`,
 * `/BS`, dash). Reused by every geometric family (shape/vertex/line); each
 * family reader layers its own geometry + extras on top.
 */
export function readStrokeFillExtras(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
): StrokeFillFields {
  const interiorColor = readAnnotColor(fn, mem, annotPtr, FPDFANNOT_COLORTYPE.InteriorColor);
  const strokeColor = readAnnotColor(fn, mem, annotPtr, FPDFANNOT_COLORTYPE.Color) ?? {
    ...DEFAULT_STROKE_COLOR,
  };
  const ca = readAnnotOpacity(fn, mem, annotPtr);
  const opacity = ca == null ? 1 : Math.max(0, Math.min(1, ca));
  const { styleCode, width } = readBorderStyle(fn, mem, annotPtr);
  const dashArray = readBorderDashPattern(fn, mem, annotPtr);

  return {
    interiorColor: interiorColor ?? null,
    strokeColor,
    strokeWidth: width,
    borderStyle: borderStyleFromCode(styleCode),
    opacity,
    ...(dashArray.length > 0 ? { dashArray } : {}),
  };
}
