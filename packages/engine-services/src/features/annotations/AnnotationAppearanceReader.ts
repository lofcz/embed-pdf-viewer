import type {
  AnnotationAppearanceMode,
  AnnotationAppearanceRaster,
  AnnotationAppearanceRenderOptions,
  AnnotationAppearancesResult,
  PageObjectNumber,
  PageRaster,
  PdfRect,
  PdfRotation,
} from '@embedpdf/engine-core/runtime';
import { normalizePdfRect } from '@embedpdf/engine-core/runtime';
import type { PdfRuntimeModule, Ptr } from '@embedpdf/pdf-runtime';

import type { DocumentSession } from '../../document-session/DocumentSession';
import { throwIfAborted } from '../../shared/abort';
import { FPDF_REVERSE_BYTE_ORDER, rasterize } from '../render/deviceRaster';
import { readAnnotRect } from './internal/read/annotationReadPrimitives';
import { readAnnotationIdentity } from './internal/read/readAnnotationIdentity';

/** `FPDF_ANNOT_WIDGET` — form-field annotation subtype code. */
const ANNOT_SUBTYPE_WIDGET = 20;

/**
 * Maps an `AnnotationAppearanceMode` onto the PDFium appearance-mode int and
 * the `EPDFAnnot_GetAvailableAppearanceModes` bit it occupies.
 *   N -> mode 0 / bit 1, R -> mode 1 / bit 2, D -> mode 2 / bit 4.
 */
const APPEARANCE_MODES: ReadonlyArray<{
  name: AnnotationAppearanceMode;
  modeInt: number;
  bit: number;
}> = [
  { name: 'normal', modeInt: 0, bit: 1 },
  { name: 'rollover', modeInt: 1, bit: 2 },
  { name: 'down', modeInt: 2, bit: 4 },
];

/**
 * Batch-renders the appearance streams (`/AP`) of every annotation on a page,
 * one bitmap per requested mode. Ported from the v2 PDFium engine's
 * `renderPageAnnotationsRaw` / `renderSingleAnnotAppearance`, but expressed in
 * PDF user space and against the `PdfRuntimeModule` (`fn` + `mem`).
 *
 * Each appearance bitmap is sized to its annotation's `/Rect` scaled by
 * `options.scale`. The shared raster helper handles PDFium's display matrix
 * convention, so this reader stays in normalized PDF page coordinates.
 */
export class AnnotationAppearanceReader {
  constructor(
    private readonly runtime: PdfRuntimeModule,
    private readonly session: DocumentSession,
  ) {}

  render(
    pageObjectNumber: PageObjectNumber,
    options: AnnotationAppearanceRenderOptions,
    signal: AbortSignal,
  ): AnnotationAppearancesResult {
    throwIfAborted(signal);
    const { fn, mem } = this.runtime;
    const pool = this.session.pagePool();
    const pagePtr = pool.acquire(pageObjectNumber);

    const scale = normalizeScale(options.scale);
    const rotation = (options.rotation ?? 0) as PdfRotation;
    const modes = resolveModes(options.modes);
    const revision = this.session.pageState(pageObjectNumber).revision;

    const appearances: AnnotationAppearanceRaster[] = [];

    try {
      const page = {
        width: fn.FPDF_GetPageWidthF(pagePtr),
        height: fn.FPDF_GetPageHeightF(pagePtr),
      };
      const count = fn.FPDFPage_GetAnnotCount(pagePtr);
      for (let i = 0; i < count; i++) {
        throwIfAborted(signal);
        const annotPtr = fn.FPDFPage_GetAnnot(pagePtr, i);
        if (!annotPtr) continue;

        try {
          const available = fn.EPDFAnnot_GetAvailableAppearanceModes(annotPtr);
          // Skip annotations without any /AP sub-dictionary. Mirrors v2.
          if (!available) continue;

          const identity = readAnnotationIdentity(fn, mem, annotPtr, pageObjectNumber, i, revision);
          // Normalize once at the read boundary — the wire `rect` and the render
          // matrix both rely on the normalized invariant.
          const rect = normalizePdfRect(readAnnotRect(fn, mem, annotPtr));

          for (const mode of modes) {
            if (!(available & mode.bit)) continue;
            const raster = this.renderOne(
              pagePtr,
              annotPtr,
              mode.modeInt,
              rect,
              page,
              rotation,
              scale,
            );
            if (!raster) continue;
            appearances.push({
              ref: identity.ref,
              mode: mode.name,
              rect,
              raster,
            });
          }
        } finally {
          fn.FPDFPage_CloseAnnot(annotPtr);
        }
      }

      return { pageState: this.session.pageState(pageObjectNumber), appearances };
    } finally {
      pool.release(pageObjectNumber);
    }
  }

  /**
   * Render a single annotation appearance into its own raster. Returns `null`
   * when the mode has no appearance stream (after an optional form-field AP
   * generation fallback) or the render fails.
   */
  private renderOne(
    pagePtr: Ptr,
    annotPtr: Ptr,
    modeInt: number,
    rect: PdfRect,
    page: { width: number; height: number },
    rotation: PdfRotation,
    scale: number,
  ): PageRaster | null {
    const { fn } = this.runtime;

    if (!fn.EPDFAnnot_HasAppearanceStream(annotPtr, modeInt)) {
      // Form widgets frequently ship without a baked /AP. Generate one on the
      // fly (same fallback as the v2 engine), then re-check.
      const subtype = fn.FPDFAnnot_GetSubtype(annotPtr);
      if (subtype === ANNOT_SUBTYPE_WIDGET && !fn.FPDFAnnot_HasKey(annotPtr, 'AP')) {
        fn.EPDFAnnot_GenerateFormFieldAP(annotPtr);
        if (!fn.EPDFAnnot_HasAppearanceStream(annotPtr, modeInt)) return null;
      } else {
        return null;
      }
    }

    // `rect` is already normalized at the read boundary; `rasterize` handles the
    // degenerate-rect / device-size / matrix / bitmap lifecycle. We supply only
    // the annotation draw (transparent background — appearances composite over
    // page content).
    return rasterize(this.runtime, {
      rect,
      page,
      rotation,
      viewport: { kind: 'scale', scale },
      background: 'transparent',
      draw: (bitmapPtr, matrixPtr) =>
        fn.EPDF_RenderAnnotBitmap(
          bitmapPtr,
          pagePtr,
          annotPtr,
          modeInt,
          matrixPtr,
          FPDF_REVERSE_BYTE_ORDER,
        ),
    });
  }
}

function resolveModes(
  requested: AnnotationAppearanceMode[] | undefined,
): ReadonlyArray<(typeof APPEARANCE_MODES)[number]> {
  if (!requested || requested.length === 0) {
    return APPEARANCE_MODES.filter((m) => m.name === 'normal');
  }
  const wanted = new Set(requested);
  return APPEARANCE_MODES.filter((m) => wanted.has(m.name));
}

function normalizeScale(scale: number | undefined): number {
  if (scale === undefined) return 1;
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return scale;
}
