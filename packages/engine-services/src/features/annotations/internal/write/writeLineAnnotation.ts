import type { LineDraft, LinePatch } from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import { setAnnotRect, setLine, setLineEndings } from './annotationWritePrimitives';
import { applyAnnotationBaseDraft, applyAnnotationBasePatch } from './writeAnnotationBase';
import { applyStrokeFillDraft, applyStrokeFillPatch } from './writeStrokeFill';

/** Default line endings when a line draft omits them. */
const DEFAULT_LINE_ENDINGS = { start: 'none', end: 'none' } as const;

/**
 * Apply a line draft to a freshly-created annotation. Order:
 *   1. base author-metadata (contents/nm)
 *   2. /Rect (required — supplied by the plugin; the engine never derives it)
 *   3. shared stroke/fill styling (/C, /CA, /BS, dash)
 *   4. /L line geometry
 *   5. /LE line endings (default none/none)
 */
export function applyLineDraft(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  draft: LineDraft,
): void {
  applyAnnotationBaseDraft(fn, mem, annotPtr, draft);
  setAnnotRect(fn, mem, annotPtr, draft.rect);
  applyStrokeFillDraft(fn, mem, annotPtr, draft);
  setLine(fn, mem, annotPtr, draft.linePoints);
  setLineEndings(fn, annotPtr, draft.lineEndings ?? DEFAULT_LINE_ENDINGS);
}

export function applyLinePatch(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  patch: LinePatch,
): void {
  applyAnnotationBasePatch(fn, mem, annotPtr, patch);
  if (patch.rect !== undefined) {
    setAnnotRect(fn, mem, annotPtr, patch.rect);
  }
  applyStrokeFillPatch(fn, mem, annotPtr, patch);
  if (patch.linePoints !== undefined) {
    setLine(fn, mem, annotPtr, patch.linePoints);
  }
  if (patch.lineEndings !== undefined) {
    setLineEndings(fn, annotPtr, patch.lineEndings);
  }
}

/**
 * Type-narrowing predicate used by the writer registry to pick the line
 * writer for a draft/patch's `subtype`.
 */
export function isLineSubtype(subtype: string): subtype is 'line' {
  return subtype === 'line';
}
