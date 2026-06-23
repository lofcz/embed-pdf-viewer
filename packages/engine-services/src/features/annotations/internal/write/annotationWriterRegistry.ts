import {
  EngineError,
  EngineErrorCode,
  type AnnotationDraft,
  type AnnotationPatch,
} from '@embedpdf/engine-core/runtime';
import type {
  CaretDraft,
  CaretPatch,
  FreeTextDraft,
  FreeTextPatch,
  InkDraft,
  InkPatch,
  LineDraft,
  LinePatch,
  PolygonDraft,
  PolygonPatch,
  PolylineDraft,
  PolylinePatch,
} from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import { applyCaretDraft, applyCaretPatch, isCaretSubtype } from './writeCaretAnnotation';
import {
  applyFreeTextDraft,
  applyFreeTextPatch,
  isFreeTextSubtype,
} from './writeFreeTextAnnotation';
import { applyInkDraft, applyInkPatch, isInkSubtype } from './writeInkAnnotation';
import { applyLineDraft, applyLinePatch, isLineSubtype } from './writeLineAnnotation';
import {
  applyShapeDraft,
  applyShapePatch,
  isShapeSubtype,
  type ShapeDraft,
  type ShapePatch,
} from './writeShapeAnnotation';
import {
  applyTextMarkupDraft,
  applyTextMarkupPatch,
  isTextMarkupSubtype,
  type TextMarkupDraft,
  type TextMarkupPatch,
} from './writeTextMarkupAnnotation';
import {
  applyPolygonDraft,
  applyPolygonPatch,
  applyPolylineDraft,
  applyPolylinePatch,
  isVertexSubtype,
} from './writeVertexAnnotation';

/**
 * Per-subtype write dispatch, mirroring the read-side registry. Adding a
 * new subtype is one extra arm here plus its writer module — no other
 * file in this package needs to change.
 *
 * The mutator calls `applyDraft` or `applyPatch` once per mutation; the
 * actual `EPDFPage_CreateAnnot` / identity resolution happens around
 * these calls in `AnnotationMutator`.
 */
export function applyDraft(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  draft: AnnotationDraft,
): void {
  if (isTextMarkupSubtype(draft.subtype)) {
    applyTextMarkupDraft(fn, mem, annotPtr, draft as TextMarkupDraft);
    return;
  }
  if (isShapeSubtype(draft.subtype)) {
    applyShapeDraft(fn, mem, annotPtr, draft as ShapeDraft);
    return;
  }
  if (isVertexSubtype(draft.subtype)) {
    if (draft.subtype === 'polygon') {
      applyPolygonDraft(fn, mem, annotPtr, draft as PolygonDraft);
    } else {
      applyPolylineDraft(fn, mem, annotPtr, draft as PolylineDraft);
    }
    return;
  }
  if (isLineSubtype(draft.subtype)) {
    applyLineDraft(fn, mem, annotPtr, draft as LineDraft);
    return;
  }
  if (isInkSubtype(draft.subtype)) {
    applyInkDraft(fn, mem, annotPtr, draft as InkDraft);
    return;
  }
  if (isFreeTextSubtype(draft.subtype)) {
    applyFreeTextDraft(fn, mem, annotPtr, draft as FreeTextDraft);
    return;
  }
  if (isCaretSubtype(draft.subtype)) {
    applyCaretDraft(fn, mem, annotPtr, draft as CaretDraft);
    return;
  }
  // Should be unreachable: AnnotationDraft is the closed union of writable
  // subtypes (which today is exactly the four text-markup kinds — the
  // unsupported kind has Draft = never). The check is here so a future
  // subtype that lands in `AnnotationDraft` without a writer entry fails
  // loud at runtime instead of silently no-op-ing.
  throw new EngineError(
    EngineErrorCode.NotImplemented,
    `no writer registered for draft.subtype='${(draft as { subtype: string }).subtype}'`,
  );
}

export function applyPatch(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  patch: AnnotationPatch,
): void {
  if (isTextMarkupSubtype(patch.subtype)) {
    applyTextMarkupPatch(fn, mem, annotPtr, patch as TextMarkupPatch);
    return;
  }
  if (isShapeSubtype(patch.subtype)) {
    applyShapePatch(fn, mem, annotPtr, patch as ShapePatch);
    return;
  }
  if (isVertexSubtype(patch.subtype)) {
    if (patch.subtype === 'polygon') {
      applyPolygonPatch(fn, mem, annotPtr, patch as PolygonPatch);
    } else {
      applyPolylinePatch(fn, mem, annotPtr, patch as PolylinePatch);
    }
    return;
  }
  if (isLineSubtype(patch.subtype)) {
    applyLinePatch(fn, mem, annotPtr, patch as LinePatch);
    return;
  }
  if (isInkSubtype(patch.subtype)) {
    applyInkPatch(fn, mem, annotPtr, patch as InkPatch);
    return;
  }
  if (isFreeTextSubtype(patch.subtype)) {
    applyFreeTextPatch(fn, mem, annotPtr, patch as FreeTextPatch);
    return;
  }
  if (isCaretSubtype(patch.subtype)) {
    applyCaretPatch(fn, mem, annotPtr, patch as CaretPatch);
    return;
  }
  throw new EngineError(
    EngineErrorCode.NotImplemented,
    `no writer registered for patch.subtype='${(patch as { subtype: string }).subtype}'`,
  );
}
