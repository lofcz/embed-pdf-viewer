import { createCapabilityToken, type PageObjectNumber } from '@embedpdf-x/kernel';
import type {
  AnnotationAppearanceImage,
  AnnotationRef,
  PdfRect,
} from '@embedpdf/engine-core/runtime';
import type {
  ChromeNode,
  Id,
  LineEndings,
  Model,
  Rect,
  RenderItem,
  Style,
  Subtype,
  ToolDefaults,
  Vec,
} from '@embedpdf-x/annotation-core';

export interface AnnotationState {
  model: Model;
}
export type AnnotationAction = { type: 'SET_MODEL'; model: Model };

/** A plugin (forms, links) marks some annotations as interactive: while engaged,
 *  they render their own DOM and are NOT geometry-editable. Suspend → editable. */
export interface Behavior {
  id: string;
  matches(a: { subtype: Subtype; ref: AnnotationRef | null }): boolean;
  engaged(): boolean;
}

export interface AnnotationCapability {
  // ── selectors ──
  pageItems(pon: PageObjectNumber): RenderItem[];
  chrome(pon: PageObjectNumber): ChromeNode[];
  selection(): Id[];
  /** The selected annotations as render items (cross-page) — for selection-aware toolbars. */
  selectedItems(): RenderItem[];
  currentStyle(): Style;
  /** What's under a content point — for the edit handler's capture decision. */
  hitKind(pon: PageObjectNumber, point: Vec): 'handle' | 'annot' | 'empty';
  /** The cursor to show at a content point (resize over a handle, move/pointer over a body, else null). */
  cursorAt(pon: PageObjectNumber, point: Vec): string | null;
  behaviorFor(a: { subtype: Subtype; ref: AnnotationRef | null }): Behavior | null;
  /** The engine's rendered /AP appearance images for a page — the `baked` visual. */
  appearances(
    pon: PageObjectNumber,
    scale: number,
    signal?: AbortSignal,
  ): Promise<AnnotationAppearanceImage[]>;
  /** Convert an engine appearance rect (PDF user space) to a content-space box, so
   *  the renderer places the baked bitmap by its OWN `/Rect` without touching the
   *  PDF↔content seam. Null if the page's crop box is unknown. */
  toContentBox(pon: PageObjectNumber, rect: PdfRect): Rect | null;
  // ── intents (run the pure core + perform engine effects) ──
  editPointer(
    phase: 'down' | 'move' | 'up',
    pon: PageObjectNumber,
    point: Vec,
    shift: boolean,
  ): void;
  createPointer(
    subtype: Subtype,
    phase: 'down' | 'move' | 'up',
    pon: PageObjectNumber,
    point: Vec,
  ): void;
  /** Create one text-markup annotation on a page from the selected text's per-line
   *  rects (content space) — the `text-selection` create gesture. */
  createMarkup(subtype: Subtype, pon: PageObjectNumber, rects: Rect[]): void;
  /** Set the live markup preview from the selection's per-page rects (renders a
   *  ghost that looks like the markup it will become). */
  previewMarkup(subtype: Subtype, rectsByPage: Record<number, Rect[]>): void;
  clearMarkupPreview(): void;
  setStyle(patch: Partial<Style>): void;
  /** Set the start/end line endings of the selected line / polyline annotations. */
  setEndings(patch: Partial<LineEndings>): void;
  /** Set a tool's (subtype's) defaults for newly drawn annotations (style + endings). */
  setDefaults(subtype: Subtype, patch: ToolDefaults): void;
  /** The resolved defaults (style + endings) a tool will use for new annotations. */
  currentDefaults(subtype: Subtype): { style: Style; endings: LineEndings };
  deleteSelection(): void;
  deselect(): void;
  cancel(): void;
  ensurePage(pon: PageObjectNumber): void; // lazy-load a page's annotations
  // ── behaviors ──
  registerBehavior(b: Behavior): () => void;
}

export const AnnotationToken = createCapabilityToken<AnnotationCapability>('annotation');
