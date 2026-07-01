import type {
  AnnotationDTO,
  AnnotationRef,
  LineEnding,
  LineEndings,
} from '@embedpdf/engine-core/runtime';
import type { PageObjectNumber } from '@embedpdf-x/kernel';
import type { Point, Rect as GeometryRect } from '@embedpdf-x/geometry';

export type { LineEnding, LineEndings };

/**
 * Content-space point/rect (y-down, PDF points, crop-relative) — the viewer space.
 * These are the shared `@embedpdf-x/geometry` primitives: a `Vec` IS a `Point`
 * and `Rect` IS geometry's `Rect`, so the whole stack speaks one vocabulary and
 * the coordinate math lives in ONE package.
 */
export type Vec = Point;
export type Rect = GeometryRect;
/** Four content-space points (a /QuadPoints quad). */
export type Quad = [Vec, Vec, Vec, Vec];

export type Id = string;
export type Cursor = string;
export type PolySubtype = 'polygon' | 'polyline';

export type Subtype =
  | 'highlight'
  | 'underline'
  | 'squiggly'
  | 'strikeout'
  | 'square'
  | 'circle'
  | 'line'
  | 'polygon'
  | 'polyline'
  | 'caret'
  | 'ink'
  | (string & {});

/**
 * Content-space geometry — the ONE thing hit-testing, editing, and rendering work
 * on. A small closed union covers every kind: shapes (rect/ellipse), line,
 * polygon/polyline (poly), text markup (quads), and caret.
 */
/**
 * A free-text callout's leader: the `/CL` line + `/LE` arrow. `tip` is the
 * called-out point (the arrow is drawn here); `knee` is the optional elbow. The
 * point where the leader meets the text box (the third `/CL` point) is NEVER
 * stored — it is DERIVED from the box + the knee (see `calloutConnection`), so it
 * can't drift when the box or knee moves. Content space (y-down).
 */
export interface Callout {
  tip: Vec;
  knee?: Vec;
  ending: LineEnding;
}

/**
 * Rotation (degrees, clockwise in content space, normalized `[0,360)`) carried by
 * the rotatable `Geom` variants. The semantics differ by family, which is exactly
 * the box-vs-vertex split:
 *
 * - **Box** (`rect`, `text`): `rect` is the UNROTATED local box and `rot` is the
 *   applied tilt — together they reconstruct the visual. The repository emits
 *   `rect` as `unrotatedRect`, `rot` as the rendered `/EMBD_Metadata/Rotation`,
 *   and the rotated visual AABB as `/Rect`, so PDFium bakes a portable `/AP`.
 * - **Vertex** (`line`, `poly`, `ink`): the points are ALREADY rotated (they are
 *   the portable visual), so `rot` is an ADVISORY scalar — the cumulative tilt the
 *   user applied since authoring. It lets EmbedPDF reconstruct an oriented
 *   selection box (`obbFromTheta`) and offer reset-to-0; it is inert for
 *   rendering (PDFium ignores a lone `Rotation` with no `UnrotatedRect`).
 */
export type Geom =
  | { t: 'rect'; rect: Rect; ellipse: boolean; rot?: number } // square / circle (rect = unrotated box)
  | { t: 'line'; a: Vec; b: Vec; ends?: LineEndings; rot?: number } // line (points pre-rotated; rot advisory)
  | { t: 'poly'; points: Vec[]; closed: boolean; ends?: LineEndings; rot?: number } // polygon/polyline (pre-rotated; rot advisory)
  | { t: 'quads'; quads: Quad[] } // highlight / underline / squiggly / strikeout
  | { t: 'caret'; rect: Rect } // caret insertion marker
  | { t: 'ink'; strokes: Vec[][]; rot?: number } // freehand ink (pre-rotated; rot advisory)
  | { t: 'text'; rect: Rect; callout?: Callout; rot?: number }; // free-text box (`rect` is the unrotated text box);
// a `callout` adds a leader line + arrow. The TEXT is data (DTO `contents`),
// rendered by the framework as an editable element, not by `scene()`.

/**
 * How a shape's outline is stroked. A discriminated union so illegal combinations
 * — a dash array on a cloudy border, an intensity on a dashed one — are simply
 * unrepresentable. Maps onto the engine's `/BS /S` (`borderStyle`), `/BS /D`
 * (`dashArray`), and `/BE /I` (`cloudyIntensity`) wire fields. Cloudy is only
 * honoured for shapes (square/circle); other kinds treat it as solid.
 */
export type Border =
  | { kind: 'solid' }
  | { kind: 'dashed'; dash: number[] }
  | { kind: 'cloudy'; intensity: number };

export interface Style {
  /** `/C` colour — stroke for geometric kinds, highlight colour for markup. */
  color: string;
  /** `/IC` interior (fill) colour. `null` when the annotation has no fill. */
  interiorColor: string | null;
  strokeWidth: number;
  opacity: number;
  /** Outline style — defaults to `{ kind: 'solid' }`. */
  border: Border;
}

/**
 * Per-tool (keyed by subtype) defaults for newly drawn annotations — the v2
 * "tool defaults" idea: a partial style override plus line endings (for the line
 * / polyline tools). Resolved against the model's base `style` at create time.
 */
export interface ToolDefaults {
  style?: Partial<Style>;
  endings?: Partial<LineEndings>;
}

export interface Annot {
  id: Id;
  ref: AnnotationRef | null;
  pon: PageObjectNumber;
  subtype: Subtype;
  geom: Geom;
  style: Style;
  locked: boolean;
  source: 'baked' | 'vector';
  /**
   * Content-space box of the engine appearance raster (the AP `/Rect`), set when
   * the annotation is derived from a DTO. While `source === 'baked'` the renderer
   * blits the engine bitmap into this box; a move translates it (a rigid shift
   * keeps the raster valid), so the bitmap rides along without re-rendering.
   * Ignored once `source === 'vector'`.
   */
  apBox?: Rect;
  /**
   * The canonical engine DTO this annotation was derived from (PDF-space, sRGB)
   * — the single source of truth for its data. `geom` and `style` are
   * content-space RENDER PROJECTIONS of it, recomputed (never edited directly)
   * whenever `data` changes, so the two can't drift. Absent only for a vector
   * draft that hasn't been committed to the engine yet (no DTO exists).
   */
  data?: AnnotationDTO;
  /**
   * Relationship to another annotation. `irt` ("in reply to") links a child to a
   * parent — a reply in a comment thread, or a caret bound to its strikeout in a
   * replace-text pair. `group` ties a set into one composite unit (created and,
   * typically, deleted together). Both are unused until comments / replace-text
   * land, but the field lives here from the start so select/delete/persistence
   * never have to be retrofitted around it.
   */
  irt?: Id;
  group?: string;
}

/** A draggable handle: a resize corner/edge (rect) or a vertex (line/poly). */
export interface Handle {
  id: string;
  at: Vec;
  cursor: Cursor;
}

export type Draft =
  | {
      g: 'create-rect';
      subtype: Subtype;
      pon: PageObjectNumber;
      from: Vec;
      to: Vec;
      ellipse: boolean;
    }
  | { g: 'create-line'; subtype: Subtype; pon: PageObjectNumber; from: Vec; to: Vec }
  | {
      g: 'create-poly';
      subtype: Subtype;
      pon: PageObjectNumber;
      points: Vec[];
      cur: Vec;
      closed: boolean;
    }
  | { g: 'create-ink'; subtype: Subtype; pon: PageObjectNumber; strokes: Vec[][] }
  | {
      // Free-text callout, built in clicks: click 1 sets `tip`, click 2 sets
      // `knee` (advancing to `box`), then a drag/click lays the text box. `cur`
      // is the live pointer for the leader/box preview; `boxFrom`/`boxTo` are the
      // dragged box once the box step starts.
      g: 'create-callout';
      subtype: Subtype;
      pon: PageObjectNumber;
      step: 'knee' | 'box';
      tip: Vec;
      knee?: Vec;
      cur: Vec;
      boxFrom?: Vec;
      boxTo?: Vec;
    }
  | { g: 'move'; ids: Id[]; start: Vec; delta: Vec }
  | { g: 'handle'; id: Id; handle: string; base: Geom; cur: Geom }
  // Rotate gesture (single OR multi-target). `pivot` is the rotation centre
  // (a single shape's own centre / the union-box centre for a group); `ids` are
  // the members being turned; `start`/`cur` are the pointer at grab and now, so
  // the live angle is `angle(cur - pivot) - angle(start - pivot)`. The base
  // geometry stays in `m.byId` until commit, so `effGeom` rotates from there.
  | { g: 'rotate'; ids: Id[]; pivot: Vec; start: Vec; cur: Vec }
  // Multi-target box transform (move/resize) computed as one Mat2D about the
  // union box. `anchor` is the fixed point of a resize (the opposite corner);
  // `sx`/`sy` the live scale; for `move` the scale is 1 and `delta` carries the
  // translation. Single-shape resize keeps using the `handle` draft above.
  | {
      g: 'group';
      op: 'resize';
      ids: Id[];
      handle: string;
      anchor: Vec;
      base: Rect;
      cur: Rect;
    }
  | { g: 'marquee'; pon: PageObjectNumber; from: Vec; to: Vec };

/** A live text-markup preview (the in-progress selection rendered as the markup it
 *  will become). Per page, since a selection can span pages. */
export interface MarkupPreview {
  subtype: Subtype;
  byPage: Record<number, Quad[]>;
}

/** Anchor + affordance state for UI that controls an in-progress creation draft. */
export interface CreationDraftAnchor {
  kind: 'poly';
  subtype: PolySubtype;
  pon: PageObjectNumber;
  bounds: Rect;
  pointCount: number;
  minPoints: number;
  canFinish: boolean;
}

export interface Model {
  byId: Record<Id, Annot>;
  order: Id[];
  selected: Id[];
  draft: Draft | null;
  /** Transient ghost of an in-progress markup selection (null when idle). */
  preview: MarkupPreview | null;
  seq: number;
  /** The base style new annotations inherit (per-tool `defaults` layer on top). */
  style: Style;
  /** Per-subtype default overrides for newly drawn annotations. */
  defaults: Record<string, ToolDefaults>;
  /** Extra clickable margin (content units) around a stroke — bump it for touch. */
  hitMargin: number;
  /** The free-text annotation currently in TEXT-EDIT mode (its `contentEditable`
   *  is focused), or null. Distinct from `selected`: you select to move/resize,
   *  you edit to type. */
  editing: Id | null;
}

export interface PointerInput {
  pon: PageObjectNumber;
  point: Vec;
  shift: boolean;
  finish?: boolean;
}

export type Msg =
  | { t: 'editPointer'; phase: 'down' | 'move' | 'up'; in: PointerInput }
  | { t: 'marqueePointer'; phase: 'down' | 'move' | 'up'; in: PointerInput }
  | { t: 'createPointer'; phase: 'down' | 'move' | 'up'; subtype: Subtype; in: PointerInput }
  | { t: 'finishCreationDraft' }
  | { t: 'createCaret'; pon: PageObjectNumber; rect: Rect }
  // text markup: build one annotation from the selected text's per-line rects (the
  // `text-selection` create gesture). One message per page the selection covers.
  | { t: 'createMarkup'; subtype: Subtype; pon: PageObjectNumber; rects: Rect[] }
  // live markup preview (the selection rendered as the markup it will become)
  | { t: 'setMarkupPreview'; subtype: Subtype; rectsByPage: Record<number, Rect[]> }
  | { t: 'clearMarkupPreview' }
  | { t: 'deselect' }
  | { t: 'setStyle'; patch: Partial<Style> }
  | { t: 'setEndings'; patch: Partial<LineEndings> }
  | { t: 'setDefaults'; subtype: Subtype; patch: ToolDefaults }
  // Rotate the current selection by a fixed quarter-turn (clockwise) about its
  // centre — the toolbar "rotate 90°" affordance. Works for a single shape or a
  // multi-target group (about the union-box centre).
  | { t: 'rotate90' }
  // Reset rotation to the as-authored orientation: box `rot → 0`; vertex points
  // spun by `-rot` about their centroid, `rot → 0`. One patch effect per member.
  | { t: 'resetRotation' }
  | { t: 'delete' }
  | { t: 'cancel' }
  | { t: 'loaded'; annots: Annot[] }
  | { t: 'created'; tempId: Id; id: Id; ref: AnnotationRef }
  | { t: 'createFailed'; tempId: Id }
  // store maintenance for the data API + collaboration: add-or-replace an
  // annotation by id (own create/update re-synced from the engine DTO, or a
  // remote edit arriving over the event stream), and remove by id (own delete
  // by ref, or a remote delete). Pure store ops — they emit no effects.
  | { t: 'upsert'; annots: Annot[] }
  | { t: 'remove'; ids: Id[] }
  // free-text editing: enter/leave the focused `contentEditable`, and apply the
  // browser's plain-text result optimistically (the plugin debounces the engine
  // write). `setText` flips the annotation to `vector` so the live text shows.
  | { t: 'beginTextEdit'; id: Id }
  | { t: 'setText'; id: Id; text: string }
  | { t: 'endTextEdit' };

export type Effect =
  | { fx: 'create'; id: Id }
  | { fx: 'patch'; id: Id }
  | { fx: 'delete'; ref: AnnotationRef };

/** Per-annotation render data — its content geometry + style + live state. */
export interface RenderItem {
  id: Id;
  ref: AnnotationRef | null;
  subtype: Subtype;
  geom: Geom;
  /**
   * The VISUAL box (geometry + stroke + line endings) in content space — the SAME
   * `geomVisualBounds` that feeds the engine `/Rect`. The renderer paints into THIS
   * box and does no bounds math of its own, so the on-screen box and the baked
   * appearance can never drift (the v2 "patch computes the rect" rule).
   */
  box: Rect;
  /**
   * Content-space box the engine appearance raster occupies (the AP `/Rect`),
   * with the live move gesture applied — so a baked annotation's bitmap follows
   * a drag. Only meaningful when `source === 'baked'`; absent otherwise.
   */
  apBox?: Rect;
  style: Style;
  source: 'baked' | 'vector' | 'ghost';
  selected: boolean;
  /**
   * Applied rotation (deg, CW), or 0/undefined. For BOX kinds (`rect`/`text`)
   * `box` is the UNROTATED visual box and the renderer applies this rotation
   * about its centre (CSS/SVG transform). For VERTEX kinds the geometry is
   * already rotated, so this is advisory only — the renderer must NOT re-apply it.
   */
  rot?: number;
  /**
   * Mix-blend-mode the annotation composites with against the page (highlights
   * multiply). The vector painter reads blend per scene node; the baked /AP image
   * has no scene, so it reads this. Undefined = normal compositing.
   */
  blend?: 'multiply';
}

/** The dumb draw vocabulary the framework renderer maps to SVG (content space).
 *  A CLOSED node (rect, ellipse, closed poly) takes the annotation's FILL colour;
 *  an open node (line, open poly — open arrows, butt, slash) is stroke-only. The
 *  stroke colour applies to every node. Closed-ness is the only fill signal. */
export type RenderNode =
  | { kind: 'rect'; rect: Rect }
  | { kind: 'ellipse'; rect: Rect }
  | { kind: 'line'; a: Vec; b: Vec }
  | { kind: 'poly'; points: Vec[]; closed: boolean }
  // a precomputed closed path (cloudy border) — `d` is SVG data in content space
  | { kind: 'path'; d: string };

/**
 * How to paint one node. The pure core fills this in (per kind/subtype), and a
 * framework renderer applies it verbatim — so ALL appearance logic (markup fill vs
 * stroke, blend, dash, derived widths) lives once, in the portable core, not in
 * every framework. Omitted `fill`/`stroke` mean none.
 */
export interface Paint {
  fill?: string;
  stroke?: string;
  width?: number; // stroke width (content units)
  opacity?: number;
  dash?: number[]; // stroke dash (content units)
  blend?: 'multiply'; // mix-blend-mode (text-highlight)
  cap?: 'round'; // stroke-linecap; omitted = the default butt. Round for freehand ink.
  join?: 'round'; // stroke-linejoin; omitted = the default miter. Round for freehand ink.
}

/**
 * A fully-painted draw node: geometry + paint. `scene(item)` returns these and a
 * per-framework painter maps each to ONE element, applying `paint` — the entire
 * surface a new framework renderer must implement. Supersedes the geometry-only
 * `RenderNode` for rendering; `geomScene` stays the internal geometry helper.
 */
export type SceneNode =
  | { kind: 'rect'; rect: Rect; paint: Paint }
  | { kind: 'ellipse'; rect: Rect; paint: Paint }
  | { kind: 'line'; a: Vec; b: Vec; paint: Paint }
  | { kind: 'poly'; points: Vec[]; closed: boolean; paint: Paint }
  | { kind: 'path'; d: string; paint: Paint };

export type ChromeNode =
  | { kind: 'outline'; rect: Rect }
  // An oriented selection box: the four corners of the (possibly tilted) OBB in
  // order, for rotatable kinds. The renderer draws the closed quad; `angle` (deg)
  // lets it orient resize cursors. Replaces the axis-aligned `outline` whenever a
  // shape (or group) carries rotation.
  | { kind: 'obb'; corners: [Vec, Vec, Vec, Vec]; angle: number }
  | { kind: 'handle'; at: Vec; cursor: Cursor }
  // The rotate knob: `at` is where the grab dot sits (hanging off the top edge),
  // `from` the edge anchor the connector stalk draws to.
  | { kind: 'rotate-knob'; at: Vec; from: Vec }
  | { kind: 'marquee'; rect: Rect };
