import { createCapabilityToken, type PageObjectNumber } from '@embedpdf-x/kernel';
import type { Point, Rect } from '@embedpdf-x/geometry';

/** A glyph address: a page + a flat glyph index within that page's geometry. */
export interface GlyphPointer {
  pon: PageObjectNumber;
  glyph: number;
}

/** Anchor = where the drag began, focus = the current end. Inclusive. */
export interface SelectionRange {
  anchor: GlyphPointer;
  focus: GlyphPointer;
}

export interface SelectionState {
  selection: SelectionRange | null;
  /** Derived highlight rects per page, in CONTENT space (y-down, PDF units). */
  rects: Record<number, Rect[]>;
  /** Pages whose text geometry has loaded (so the layer re-renders when ready). */
  loaded: Record<number, boolean>;
}

export type SelectionAction =
  | { type: 'PAGE_LOADED'; pon: PageObjectNumber }
  | { type: 'SET'; selection: SelectionRange; rects: Record<number, Rect[]> }
  | { type: 'CLEAR' };

export interface SelectionCapability {
  /** Warm a page's text geometry (idempotent). Layers call this when a page mounts. */
  ensurePage(pon: PageObjectNumber): void;
  isLoaded(pon: PageObjectNumber): boolean;
  /** Begin a selection at a page point (content space). */
  beginAt(pon: PageObjectNumber, point: Point): void;
  /** Extend the current selection to a page point. */
  extendTo(pon: PageObjectNumber, point: Point): void;
  end(): void;
  clear(): void;
  /** Highlight rects for a page, in content space — the layer's only input. */
  rectsForPage(pon: PageObjectNumber): Rect[];
  hasSelection(): boolean;
}

export const SelectionToken = createCapabilityToken<SelectionCapability>('selection');
