/**
 * Wire-stable primitives shared by every annotation DTO.
 *
 * These do not depend on PDFium or any browser/Node surface; they are
 * the lingua franca between local engine, cloud engine, and server.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  /** Left edge in user space. */
  left: number;
  /** Top edge in user space (PDF user space has origin at bottom-left, so top > bottom). */
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Rotation = 0 | 90 | 180 | 270;

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
 * /QuadPoints entry as four corners (TL, TR, BL, BR per PDF 32000 12.5.6.10).
 * Stored as four Points so the wire format is self-describing instead of
 * an opaque 8-float array.
 */
export interface QuadPoint {
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
  bottomRight: Point;
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
