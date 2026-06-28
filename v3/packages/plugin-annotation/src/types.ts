import { createCapabilityToken, type PageObjectNumber } from '@embedpdf-x/kernel';
import type {
  AnnotationAppearanceImage,
  AnnotationDraft,
  AnnotationDTO,
  AnnotationPatch,
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

/**
 * A free-text annotation projected for the framework: the box (content space,
 * live gesture applied) + the plain text + an `editing` flag + a ready-to-spread
 * CSS style. The framework renders ONE editable element from this and nothing
 * more — all the mapping (fonts, colours, alignment) is done here, once.
 */
export interface TextItem {
  id: Id;
  ref: AnnotationRef | null;
  box: Rect;
  contents: string;
  editing: boolean;
  css: {
    fontFamily: string;
    /** Content units (the framework multiplies by the page scale). */
    fontSize: number;
    lineHeight: number;
    color: string;
    align: 'left' | 'center' | 'right';
    padding: number;
    /** `/C` box background as a CSS colour, or null for transparent. */
    background: string | null;
  };
}

/**
 * The PUBLIC annotation API — the documented, stable surface for application code
 * (toolbars, sidebars, app logic). Resolve it with the token re-exported from the
 * package root (`@embedpdf-x/plugin-annotation`).
 *
 * Framework-only plumbing (render projection, pointer gestures, behavior
 * registration) lives on {@link AnnotationHostCapability}, reachable only through
 * the `@embedpdf-x/plugin-annotation/internal` entry. Both are the SAME runtime
 * object — two typed lenses on one token — so app code simply can't see the host
 * methods.
 */
export interface AnnotationCapability {
  // ── data API: the mutation vocabulary (engine-core types, addressable by ref) ──
  /**
   * Create an annotation on a page. `draft` is the engine-core draft for its
   * subtype (PDF-space, sRGB). Resolves to the new annotation's durable `ref`.
   * The same path the draw tools use, so programmatic and interactive creation
   * share one optimistic flow + one event stream.
   */
  create(pon: PageObjectNumber, draft: AnnotationDraft): Promise<AnnotationRef>;
  /**
   * Patch an existing annotation. `patch` is the engine-core patch for the
   * annotation's subtype — style, endings, contents, geometry are ALL just
   * fields here (there is no separate "set style"). Attribution is automatic
   * from the session identity.
   */
  update(ref: AnnotationRef, patch: AnnotationPatch): Promise<void>;
  /** Delete an annotation by ref. */
  delete(ref: AnnotationRef): Promise<void>;
  /**
   * Restyle the current selection — sugar over {@link update}. Applies a
   * content-space style/endings change to each selected annotation through the
   * full converter (cloudy borders, line endings, and per-kind fields are all
   * handled), issuing one engine write per annotation.
   */
  updateSelection(patch: { style?: Partial<Style>; endings?: Partial<LineEndings> }): Promise<void>;

  // ── authorization (mirrors the engine's own enforcement; the engine still
  //    independently enforces, and per-owner collab rules are checked there) ──
  canCreate(): boolean;
  canEdit(ref: AnnotationRef): boolean;
  canDelete(ref: AnnotationRef): boolean;

  // ── reads (canonical engine DTOs) ──
  /** The annotation for a ref, or null if unknown / not yet committed. */
  get(ref: AnnotationRef): AnnotationDTO | null;
  /** Every committed annotation on a page, in z-order. */
  list(pon: PageObjectNumber): AnnotationDTO[];
  /** The selected annotations as DTOs (skips not-yet-committed drafts). */
  getSelected(): AnnotationDTO[];

  // ── selection ──
  selection(): Id[];
  /** The current selection as durable annotation refs (skips not-yet-committed drafts). */
  getSelection(): AnnotationRef[];

  // ── tool defaults (LOCAL drawing preferences — never collaborative) ──
  /** Set a tool's (subtype's) defaults for newly drawn annotations (style + endings). */
  setDefaults(subtype: Subtype, patch: ToolDefaults): void;
  /** The resolved defaults (style + endings) a tool will use for new annotations. */
  currentDefaults(subtype: Subtype): { style: Style; endings: LineEndings };
  // ── lifecycle ──
  deleteSelection(): void;
  deselect(): void;
  cancel(): void;
}

/**
 * The HOST (framework) surface: everything the render layer, the interaction hub,
 * and sibling plugins need, on top of the public {@link AnnotationCapability}.
 * Internal — import the token from `@embedpdf-x/plugin-annotation/internal`, never
 * from application code.
 */
export interface AnnotationHostCapability extends AnnotationCapability {
  // ── render projection (consumed by the framework render layer) ──
  pageItems(pon: PageObjectNumber): RenderItem[];
  chrome(pon: PageObjectNumber): ChromeNode[];
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
  ensurePage(pon: PageObjectNumber): void; // lazy-load a page's annotations
  // ── free-text (the editable-element layer) ──
  /** The free-text boxes on a page, ready to render as editable elements. */
  textItems(pon: PageObjectNumber): TextItem[];
  /** The id of the annotation currently being text-edited, or null. Read live (not
   *  from a stale render) so the editor can tell a real exit from a focus-steal. */
  currentEditing(): Id | null;
  /** Enter text-edit on a free-text annotation (focus its editable element). */
  beginTextEdit(ref: AnnotationRef): void;
  /** Enter text-edit on whatever free-text box is under a content point — wired
   *  to a double-click by the interaction edit handler. */
  beginTextEditAt(pon: PageObjectNumber, point: Vec): void;
  /** Apply the editor's plain text — optimistic locally, debounced to the engine. */
  setContents(ref: AnnotationRef, text: string): void;
  /** Leave text-edit (flush any pending write). */
  endTextEdit(): void;
  // ── hit-testing & cursor (consumed by the interaction edit handler) ──
  /** What's under a content point — for the edit handler's capture decision. */
  hitKind(pon: PageObjectNumber, point: Vec): 'handle' | 'annot' | 'empty';
  /** The cursor to show at a content point (resize over a handle, move/pointer over a body, else null). */
  cursorAt(pon: PageObjectNumber, point: Vec): string | null;
  behaviorFor(a: { subtype: Subtype; ref: AnnotationRef | null }): Behavior | null;
  // ── interaction intents (run the pure core + perform engine effects) ──
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
  // ── extension point for sibling plugins (forms, links) ──
  registerBehavior(b: Behavior): () => void;
}

/**
 * The annotation capability token. Typed to the full {@link AnnotationHostCapability}
 * here (the package internals + the `/internal` entry use this view). The package
 * root re-exports the SAME token narrowed to {@link AnnotationCapability}.
 */
export const AnnotationToken = createCapabilityToken<AnnotationHostCapability>('annotation');
