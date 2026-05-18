import type { PageState } from '../revision/PageState';

export interface PageGeometryGlyph {
  x: number;
  y: number;
  width: number;
  height: number;
  flags: number;
  tightX?: number;
  tightY?: number;
  tightWidth?: number;
  tightHeight?: number;
}

export interface PageGeometryRun {
  rect: { x: number; y: number; width: number; height: number };
  charStart: number;
  glyphs: PageGeometryGlyph[];
  fontSize?: number;
}

/**
 * Geometry-only text layout for one page.
 *
 * `runs` intentionally mirrors the old engine's `PdfPageGeometry`
 * payload so selection code can migrate without reshaping glyph data.
 * `pageState` is the v3 page-scoped read envelope used for revision
 * and weak-reference bookkeeping.
 */
export interface PageGeometrySnapshot {
  pageState: PageState;
  runs: PageGeometryRun[];
}
