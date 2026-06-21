/**
 * Wire-stable annotation primitives that are NOT pure geometry.
 *
 * Geometry primitives (points, rects, sizes, quads, rotation) now live in
 * `../geometry` as the canonical `Pdf*` vocabulary. The aliases below are
 * TRANSITIONAL re-exports kept only so existing consumers keep compiling
 * during the geometry consolidation; new code should import `Pdf*` directly
 * from `../geometry`.
 *
 * These do not depend on PDFium or any browser/Node surface; they are
 * the lingua franca between local engine, cloud engine, and server.
 */

import type { PdfPoint, PdfRect, PdfRotation, PdfSize } from '../geometry/primitives';

/** @deprecated Use `PdfPoint` from `../geometry`. */
export type Point = PdfPoint;
/** @deprecated Use `PdfRect` from `../geometry`. */
export type Rect = PdfRect;
/** @deprecated Use `PdfSize` from `../geometry`. */
export type Size = PdfSize;
/** @deprecated Use `PdfRotation` from `../geometry`. */
export type Rotation = PdfRotation;

/**
 * sRGB color with optional alpha. Components are 0..255 integers; alpha is
 * 0..1 float when present (matches PDF /CA). Engines normalize PDFium's
 * device color space into sRGB at read time.
 */
export interface Color {
  r: number;
  g: number;
  b: number;
  a?: number;
}

/**
 * /LE entries (line endings). Maps PDFium FPDFAnnot_GetLineEndings codes
 * onto the spec names. We use kebab-case so the wire format is stable
 * across language ports.
 */
export type LineEnding =
  | 'none'
  | 'square'
  | 'circle'
  | 'diamond'
  | 'open-arrow'
  | 'closed-arrow'
  | 'butt'
  | 'r-open-arrow'
  | 'r-closed-arrow'
  | 'slash';

/**
 * Border/line style for shape annotations — the `/BS /S` (border style)
 * subset PDFium can author. Maps onto the ISO 32000 §8.4.3.3 border style
 * names. Cloudy borders are a SEPARATE concern (`/BE` border effect),
 * surfaced as `cloudyIntensity` on the shape DTO, not as a border style.
 *
 * kebab-/lower-case so the wire format is stable across language ports;
 * the engine maps these onto PDFium's integer codes at write time.
 */
export type AnnotationBorderStyle = 'solid' | 'dashed' | 'beveled' | 'inset';

/**
 * `/RD` (rectangle differences) for shape annotations — the four margins,
 * in PDF points, between the annotation `/Rect` and the geometry actually
 * drawn inside it. Used so a thick/cloudy border has room to render
 * without being clipped by the `/Rect`. y-up PDF user space, so each value
 * is a non-negative inset from the corresponding `/Rect` edge.
 */
export interface PdfRectDifferences {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Bitset wrapper for the `/F` (Annotation Flags) PDF entry. We expose each
 * bit as its own boolean so callers don't have to know the bit positions.
 */
export interface AnnotationFlags {
  invisible: boolean;
  hidden: boolean;
  print: boolean;
  noZoom: boolean;
  noRotate: boolean;
  noView: boolean;
  readOnly: boolean;
  locked: boolean;
  toggleNoView: boolean;
  lockedContents: boolean;
}

export const NO_ANNOTATION_FLAGS: AnnotationFlags = {
  invisible: false,
  hidden: false,
  print: false,
  noZoom: false,
  noRotate: false,
  noView: false,
  readOnly: false,
  locked: false,
  toggleNoView: false,
  lockedContents: false,
};
