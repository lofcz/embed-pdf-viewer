import {
  EngineError,
  EngineErrorCode,
  sniffBinaryMetadata,
  type BinaryMetadata,
  type PdfRect,
  type ResourceRef,
  type StampFit,
  type StampWireDraft,
  type StampWirePatch,
  type WireResource,
} from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import { F32_BYTES } from '../../../../runtime/memory/structs';
import { readAnnotRect } from '../read/annotationReadPrimitives';
import { STAMP_NAME_TO_CODE } from '../stampName';
import type { AnnotationWriteContext } from './annotationWriteContext';
import { setAnnotRect } from './annotationWritePrimitives';
import { applyAnnotationBaseDraft, applyAnnotationBasePatch } from './writeAnnotationBase';
import { writeBoxTransformMetadata } from './writeAnnotationTransformMetadata';

/** `EPDF_STAMP_FIT` codes from `public/fpdf_annot.h` (CSS `object-fit` naming on the wire). */
const STAMP_FIT_TO_CODE: Record<StampFit, number> = {
  contain: 0, // EPDF_STAMP_FIT_CONTAIN
  cover: 1, // EPDF_STAMP_FIT_COVER
  fill: 2, // EPDF_STAMP_FIT_STRETCH
};

/**
 * Apply a stamp draft. Order mirrors the other writers (base → /Rect →
 * subtype fields), then the content pipeline:
 *   1. resolve the `{ resource }` ref against the mutation's binary payloads
 *   2. sniff the bytes (PNG/JPEG → image object, PDF → cloned form XObject)
 *   3. `EPDFAnnot_UpdateAppearanceToRect` fits the appearance into /Rect
 *      honouring `fit` and any `/EMBD_Metadata` rotation.
 * The mutator's `EPDFAnnot_GenerateAppearance` pass afterwards is a no-op
 * for stamps (CPDF_GenerateAP has no stamp arm), so the appearance built
 * here is what ships.
 */
export function applyStampDraft(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  draft: StampWireDraft,
  ctx?: AnnotationWriteContext,
): void {
  applyAnnotationBaseDraft(fn, mem, annotPtr, draft);
  setAnnotRect(fn, mem, annotPtr, draft.rect);
  if (draft.name !== undefined) {
    setStampName(fn, annotPtr, draft.name);
  }
  writeBoxTransformMetadata(fn, mem, annotPtr, {
    rotation: draft.rotation,
    unrotatedRect: draft.unrotatedRect,
  });
  setStampContent(fn, mem, annotPtr, draft.source, draft.fit ?? 'contain', draft.rect, ctx);
}

export function applyStampPatch(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  patch: StampWirePatch,
  ctx?: AnnotationWriteContext,
): void {
  applyAnnotationBasePatch(fn, mem, annotPtr, patch);
  if (patch.rect !== undefined) {
    setAnnotRect(fn, mem, annotPtr, patch.rect);
  }
  if (patch.name !== undefined) {
    setStampName(fn, annotPtr, patch.name);
  }
  if (patch.rotation !== undefined || patch.unrotatedRect !== undefined) {
    writeBoxTransformMetadata(fn, mem, annotPtr, {
      rotation: patch.rotation,
      unrotatedRect: patch.unrotatedRect,
    });
  }
  if (patch.source !== undefined) {
    // Content replacement: clear + rebuild the appearance from the new bytes.
    const rect = patch.rect ?? readAnnotRect(fn, mem, annotPtr);
    setStampContent(fn, mem, annotPtr, patch.source, patch.fit ?? 'contain', rect, ctx);
  } else if (
    patch.rect !== undefined ||
    patch.fit !== undefined ||
    patch.rotation !== undefined ||
    patch.unrotatedRect !== undefined
  ) {
    // Geometry-only patch: re-fit the existing appearance into the new /Rect.
    refitAppearance(fn, annotPtr, patch.fit ?? 'contain');
  }
}

export function isStampSubtype(subtype: string): subtype is 'stamp' {
  return subtype === 'stamp';
}

function setStampName(fn: PdfFunctions, annotPtr: Ptr, name: string): void {
  const code = STAMP_NAME_TO_CODE[name];
  if (code === undefined) {
    throw new EngineError(
      EngineErrorCode.InvalidArg,
      `unknown stamp name '${name}'; supported names: ${Object.keys(STAMP_NAME_TO_CODE).join(', ')}`,
    );
  }
  if (!fn.EPDFAnnot_SetName(annotPtr, code)) {
    throw new EngineError(EngineErrorCode.Unknown, 'EPDFAnnot_SetName returned false');
  }
}

function requireStampResource(
  ref: ResourceRef,
  ctx: AnnotationWriteContext | undefined,
): WireResource {
  const resource = ctx?.resources?.[ref.resource];
  if (!resource) {
    throw new EngineError(
      EngineErrorCode.InvalidArg,
      `stamp source references resource '${ref.resource}' but no such binary payload accompanied the mutation`,
    );
  }
  return resource;
}

function setStampContent(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  ref: ResourceRef,
  fit: StampFit,
  rect: PdfRect,
  ctx: AnnotationWriteContext | undefined,
): void {
  const resource = requireStampResource(ref, ctx);
  const meta = sniffBinaryMetadata(resource.bytes);
  if (!meta) {
    throw new EngineError(
      EngineErrorCode.InvalidArg,
      'stamp source must be PNG, JPEG, or single-page PDF bytes',
    );
  }
  if (ctx?.docPtr === undefined || ctx?.pagePtr === undefined) {
    throw new EngineError(
      EngineErrorCode.Unknown,
      'stamp writer requires docPtr/pagePtr on the write context',
    );
  }

  // Replace, not merge: drop any existing appearance objects (no-op on create).
  for (let i = fn.FPDFAnnot_GetObjectCount(annotPtr) - 1; i >= 0; i--) {
    fn.FPDFAnnot_RemoveObject(annotPtr, i);
  }

  if (meta.mimeType === 'application/pdf') {
    setAppearanceFromPdfBytes(fn, mem, annotPtr, resource.bytes);
  } else {
    appendImageObject(fn, mem, annotPtr, ctx.docPtr, ctx.pagePtr, resource.bytes, meta, rect, fit);
  }

  // Normalises the AP (BBox, EPDFOrigContentRect for future re-fits) and
  // applies any /EMBD_Metadata rotation — same closing step as v2.
  refitAppearance(fn, annotPtr, fit);
}

function refitAppearance(fn: PdfFunctions, annotPtr: Ptr, fit: StampFit): void {
  if (!fn.EPDFAnnot_UpdateAppearanceToRect(annotPtr, STAMP_FIT_TO_CODE[fit])) {
    throw new EngineError(
      EngineErrorCode.Unknown,
      'EPDFAnnot_UpdateAppearanceToRect returned false',
    );
  }
}

/**
 * PNG/JPEG → image object appended to the appearance.
 *
 * The AP's coordinate space aligns with page space (its BBox is the annot
 * `/Rect`, same as v2), so the image must be painted INSIDE `/Rect` or it
 * falls outside the form's clip and renders blank. The `fit` placement is
 * computed here from the sniffed intrinsic dimensions; the closing
 * `EPDFAnnot_UpdateAppearanceToRect` pass then normalises the BBox and
 * records `EPDFOrigContentRect` so later geometry-only patches can re-fit
 * natively.
 */
function appendImageObject(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  docPtr: Ptr,
  pagePtr: Ptr,
  bytes: ArrayBuffer,
  meta: Extract<BinaryMetadata, { width: number }>,
  rect: PdfRect,
  fit: StampFit,
): void {
  const imageObjPtr = fn.FPDFPageObj_NewImageObj(docPtr);
  if (!imageObjPtr) {
    throw new EngineError(EngineErrorCode.Unknown, 'FPDFPageObj_NewImageObj returned NULL');
  }

  let appended = false;
  try {
    const dataPtr = mem.alloc(bytes.byteLength);
    try {
      mem.writeBytes(dataPtr, new Uint8Array(bytes));
      const ok =
        meta.mimeType === 'image/png'
          ? fn.EPDFImageObj_SetPng(pagePtr, 0, imageObjPtr, dataPtr, bytes.byteLength)
          : fn.EPDFImageObj_SetJpeg(pagePtr, 0, imageObjPtr, dataPtr, bytes.byteLength);
      if (!ok) {
        throw new EngineError(
          EngineErrorCode.InvalidArg,
          `${meta.mimeType === 'image/png' ? 'EPDFImageObj_SetPng' : 'EPDFImageObj_SetJpeg'} rejected the image data`,
        );
      }
    } finally {
      mem.free(dataPtr);
    }

    const placement = fitIntoRect(meta.width, meta.height, rect, fit);
    setImageMatrix(fn, mem, imageObjPtr, placement.width, placement.height);
    fn.FPDFPageObj_Transform(imageObjPtr, 1, 0, 0, 1, placement.left, placement.bottom);

    if (!fn.FPDFAnnot_AppendObject(annotPtr, imageObjPtr)) {
      throw new EngineError(EngineErrorCode.Unknown, 'FPDFAnnot_AppendObject returned false');
    }
    appended = true;
  } finally {
    // The annotation owns the object once appended; on failure we own it.
    if (!appended) {
      fn.FPDFPageObj_Destroy(imageObjPtr);
    }
  }
}

/** Fit-policy placement of `w×h` content inside `rect` (centered for the aspect-preserving fits). */
function fitIntoRect(
  w: number,
  h: number,
  rect: PdfRect,
  fit: StampFit,
): { left: number; bottom: number; width: number; height: number } {
  const boxW = Math.max(0, rect.right - rect.left);
  const boxH = Math.max(0, rect.top - rect.bottom);
  if (fit === 'fill' || w <= 0 || h <= 0) {
    return { left: rect.left, bottom: rect.bottom, width: boxW, height: boxH };
  }
  const scale = fit === 'contain' ? Math.min(boxW / w, boxH / h) : Math.max(boxW / w, boxH / h);
  const width = w * scale;
  const height = h * scale;
  return {
    left: rect.left + (boxW - width) / 2,
    bottom: rect.bottom + (boxH - height) / 2,
    width,
    height,
  };
}

/** FS_MATRIX { a, b, c, d, e, f } — six f32s. */
function setImageMatrix(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  imageObjPtr: Ptr,
  width: number,
  height: number,
): void {
  const buf = mem.alloc(6 * F32_BYTES);
  try {
    mem.poke(buf, 'f32', width, 0);
    mem.poke(buf, 'f32', 0, 4);
    mem.poke(buf, 'f32', 0, 8);
    mem.poke(buf, 'f32', height, 12);
    mem.poke(buf, 'f32', 0, 16);
    mem.poke(buf, 'f32', 0, 20);
    if (!fn.FPDFPageObj_SetMatrix(imageObjPtr, buf)) {
      throw new EngineError(EngineErrorCode.Unknown, 'FPDFPageObj_SetMatrix returned false');
    }
  } finally {
    mem.free(buf);
  }
}

/**
 * Single-page PDF → deep-cloned Form XObject as AP/N (the v2 rubber-stamp
 * path). The source buffer must stay alive until the temp document closes.
 */
function setAppearanceFromPdfBytes(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  bytes: ArrayBuffer,
): void {
  const dataPtr = mem.alloc(bytes.byteLength);
  try {
    mem.writeBytes(dataPtr, new Uint8Array(bytes));
    const tempDocPtr = fn.FPDF_LoadMemDocument(dataPtr, bytes.byteLength, '');
    if (!tempDocPtr) {
      throw new EngineError(EngineErrorCode.MalformedPdf, 'stamp source PDF could not be opened');
    }
    try {
      if (!fn.EPDFAnnot_SetAppearanceFromPage(annotPtr, tempDocPtr, 0)) {
        throw new EngineError(
          EngineErrorCode.Unknown,
          'EPDFAnnot_SetAppearanceFromPage returned false',
        );
      }
    } finally {
      fn.FPDF_CloseDocument(tempDocPtr);
    }
  } finally {
    mem.free(dataPtr);
  }
}
