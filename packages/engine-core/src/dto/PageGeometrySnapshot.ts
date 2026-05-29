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
 *
 * Pure content, addressed and cached by `contentVersion`. Carries NO
 * annotation liveness envelope (`PageState`) — see `PageTextSnapshot` for
 * the rationale; liveness lives on annotation reads.
 */
export interface PageGeometrySnapshot {
  runs: PageGeometryRun[];
}
