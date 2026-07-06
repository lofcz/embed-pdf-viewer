import { createCapabilityToken, type PageObjectNumber } from '@embedpdf-x/kernel';
import type {
  AnnotationAppearanceImage,
  AnnotationDraft,
  AnnotationDTO,
  AnnotationPatch,
  AnnotationRef,
  BinarySource,
  PdfRect,
} from '@embedpdf/engine-core/runtime';
import type {
  AnnotationProps,
  AnnotationPropsPatch,
  ChromeNode,
  CreationDraftAnchor,
  Id,
  Model,
  PropKey,
  PropSpec,
  Rect,
  RenderItem,
  SnapSettings,
  Subtype,
  Vec,
} from '@embedpdf-x/annotation-core';

export interface AnnotationState {
  model: Model;
}

/** Registration options for {@link annotationPlugin} — the initial values of the
 *  live-adjustable {@link AnnotationCapability.setSnap} settings. */
export interface AnnotationConfig {
  snap?: {
    /** Alignment guides while moving (snap to other annotations + the page).
     *  Default true. */
    guides?: boolean;
    /** Guide snap tolerance, content units (PDF pt). Default 5. */
    guideThreshold?: number;
    /** Snap the rotate gesture onto `rotationAngles`. Default true. */
    rotation?: boolean;
    /** Default `[0, 90, 180, 270]`. */
    rotationAngles?: number[];
    /** Rotation snap tolerance, degrees. Default 4. */
    rotationThreshold?: number;
  };
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
 * The current selection's editable properties, ready to render: the ordered
 * {@link PropSpec}s EVERY selected kind declares (a mixed selection shows the
 * shared subset, in the first kind's order), the first member's `values`, and
 * which keys differ across members (`mixed` — render an indeterminate control).
 * Empty `specs` = nothing selected / nothing editable.
 */
export interface SelectionProps {
  specs: PropSpec[];
  values: Partial<AnnotationProps>;
  mixed: PropKey[];
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
  /** Applied rotation (deg, CW). `box` is the UNROTATED text box; the framework
   *  rotates the editable element about its centre by this. 0/undefined = none. */
  rot?: number;
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
   * Restyle the current selection with ONE flat property patch — the write half
   * of {@link getSelectionProps}. Each selected annotation takes the keys its
   * kind declares (`propsFor`) and ignores the rest, so a single patch restyles
   * a mixed selection. Optimistic: the model updates immediately; one engine
   * write per changed member re-syncs from the authoritative DTO.
   */
  updateSelection(patch: AnnotationPropsPatch): void;

  // ── property introspection (the machine-readable "what can I edit here") ──
  /**
   * The selection's editable properties: ordered specs shared by every selected
   * kind + current values + which keys are mixed. THE way to build a property
   * sidebar/toolbar — render `specs` in order, write back via
   * {@link updateSelection}. Stable reference between model changes.
   */
  getSelectionProps(): SelectionProps;
  /** The ordered property specs a TOOL's target kind declares (callout → the
   *  free-text kind). Drives the same sidebar when nothing is selected, paired
   *  with {@link currentDefaults}/{@link setDefaults}. */
  propsForTool(toolId: string): PropSpec[];

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

  // ── grouping (engine `/IRT` + `/RT /Group`; selecting one member selects all) ──
  /** Group the current selection into one unit (the bottom-most member is the
   *  primary; the rest become `/RT /Group` subordinates). Page-local: no-op
   *  unless 2+ committed annotations on a single page are selected. */
  group(): Promise<void>;
  /** Ungroup the group(s) the current selection touches — every subordinate
   *  becomes top-level again. */
  ungroup(): Promise<void>;
  /** Whether {@link group} would do something for the current selection. */
  canGroup(): boolean;
  /** Whether {@link ungroup} would do something for the current selection. */
  canUngroup(): boolean;

  // ── tool defaults (LOCAL drawing preferences — never collaborative) ──
  /** Patch a tool's defaults for newly drawn annotations — the SAME flat
   *  vocabulary {@link updateSelection} writes. */
  setDefaults(subtype: Subtype, patch: AnnotationPropsPatch): void;
  /** The RESOLVED full props bag a tool will use for new annotations. */
  currentDefaults(subtype: Subtype): AnnotationProps;
  // ── snapping (alignment guides while moving + rotation snap) ──
  /** Live-adjust snapping — wire a UI toggle here (e.g.
   *  `setSnap({ guides: false })`). Initial values come from the plugin's
   *  registration config ({@link AnnotationConfig}). */
  setSnap(patch: Partial<SnapSettings>): void;
  /** The current snap settings. */
  snapSettings(): SnapSettings;
  // ── rotation (selection-scoped; rotatable kinds only) ──
  /** Rotate the current selection a quarter-turn clockwise about its centre
   *  (a single shape's own centre / the union-box centre for a group). */
  rotateSelection90(): void;
  /** Reset the current selection to its as-authored orientation (rotation → 0). */
  resetSelectionRotation(): void;
  // ── stamp tool (click-to-place with an armed binary payload) ──
  /**
   * Arm the stamp tool: `source` (PNG, JPEG, or single-page PDF bytes —
   * format sniffed, never trusted) becomes the content of the next stamp(s)
   * placed by clicking a page. The placement rect is sized from the image's
   * intrinsic aspect ratio around `targetWidth` (PDF points, default 150)
   * and centred on the click. Also activates the `'stamp'` interaction tool;
   * the payload stays armed for repeat placement until the tool changes or
   * {@link disarmStamp} is called. Resolves once the payload is validated.
   */
  armStamp(input: StampToolInput): Promise<void>;
  /** Drop the armed stamp payload (a tool change away from 'stamp' does this too). */
  disarmStamp(): void;

  // ── lifecycle ──
  deleteSelection(): void;
  deselect(): void;
  cancel(): void;
}

/** Payload for {@link AnnotationCapability.armStamp}. */
export interface StampToolInput {
  /** PNG, JPEG, or single-page PDF bytes (`Blob | Uint8Array | BinaryPayload`). */
  source: BinarySource;
  /** Placed width in PDF points (height follows the intrinsic aspect). Default 150. */
  targetWidth?: number;
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
  /** The anchor for a selection-aware floating menu: the primary page + the
   *  selection's union box on that page (content space), or null when nothing
   *  selectable is selected. One anchor regardless of cross-page selection. */
  selectionAnchor(): { pon: PageObjectNumber; bounds: Rect; knob?: Vec } | null;
  /** The anchor + action state for a live multi-click creation draft, or null. */
  creationDraftAnchor(): CreationDraftAnchor | null;
  /** Cache key for a page's baked appearances: the COMMITTED id + AP box of every
   *  baked annotation (gesture previews excluded). Changes exactly once per
   *  committed create/geometry-edit, so the render layer refetches rasters then —
   *  and only then (a stamp resize re-fits its AP engine-side, for example). */
  appearanceEpoch(pon: PageObjectNumber): string;
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
  /**
   * Drop and RE-READ one page's annotations from the engine — the hook for
   * cross-plane mutations (e.g. `doc.forms.createField`/`deleteField`
   * changing the page's widget population underneath this plugin).
   */
  reloadPage(pon: PageObjectNumber): void;
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
  hitKind(
    pon: PageObjectNumber,
    point: Vec,
  ): 'handle' | 'rotate' | 'group-handle' | 'annot' | 'empty';
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
  marqueePointer(
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
    finish?: boolean,
  ): void;
  finishCreationDraft(): void;
  cancelCreationDraft(): void;
  /** Create one text-markup annotation on a page from the selected text's per-line
   *  rects (content space) — the `text-selection` create gesture. */
  createMarkup(subtype: Subtype, pon: PageObjectNumber, rects: Rect[]): void;
  /** Create a caret annotation from the final line rect of a text selection. */
  createCaret(pon: PageObjectNumber, textEndRect: Rect): void;
  /** Set the live markup preview from the selection's per-page rects (renders a
   *  ghost that looks like the markup it will become). */
  previewMarkup(subtype: Subtype, rectsByPage: Record<number, Rect[]>): void;
  clearMarkupPreview(): void;
  // ── stamp placement (consumed by the interaction stamp handler) ──
  /** Place the armed stamp centred on a content point. Returns false (no
   *  capture) when nothing is armed. */
  placeArmedStamp(pon: PageObjectNumber, point: Vec): boolean;
  // ── extension point for sibling plugins (forms, links) ──
  registerBehavior(b: Behavior): () => void;
}

/**
 * The annotation capability token. Typed to the full {@link AnnotationHostCapability}
 * here (the package internals + the `/internal` entry use this view). The package
 * root re-exports the SAME token narrowed to {@link AnnotationCapability}.
 */
export const AnnotationToken = createCapabilityToken<AnnotationHostCapability>('annotation');
