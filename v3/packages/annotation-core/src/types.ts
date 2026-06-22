import type { AnnotationRef, LineEnding, LineEndings } from '@embedpdf/engine-core/runtime';
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
  | (string & {});

/** Kinds the v3 plugin can geometry-edit today (the rest render baked, read-only). */
export const EDITABLE_SUBTYPES: ReadonlySet<string> = new Set([
  'square',
  'circle',
  'line',
  'polygon',
  'polyline',
]);

/**
 * Content-space geometry — the ONE thing hit-testing, editing, and rendering work
 * on. A small closed union covers every kind: shapes (rect/ellipse), line,
 * polygon/polyline (poly), text markup (quads).
 */
export type Geom =
  | { t: 'rect'; rect: Rect; ellipse: boolean } // square / circle
  | { t: 'line'; a: Vec; b: Vec; ends?: LineEndings } // line (optional /LE endings)
  | { t: 'poly'; points: Vec[]; closed: boolean; ends?: LineEndings } // polygon (closed) / polyline (open, /LE endings)
  | { t: 'quads'; quads: Quad[] }; // highlight / underline / squiggly / strikeout

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
  strokeColor: string;
  fillColor: string | null;
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
  | { g: 'move'; ids: Id[]; start: Vec; delta: Vec }
  | { g: 'handle'; id: Id; handle: string; base: Geom; cur: Geom }
  | { g: 'marquee'; pon: PageObjectNumber; from: Vec; to: Vec };

export interface Model {
  byId: Record<Id, Annot>;
  order: Id[];
  selected: Id[];
  draft: Draft | null;
  seq: number;
  /** The base style new annotations inherit (per-tool `defaults` layer on top). */
  style: Style;
  /** Per-subtype default overrides for newly drawn annotations. */
  defaults: Record<string, ToolDefaults>;
  /** Extra clickable margin (content units) around a stroke — bump it for touch. */
  hitMargin: number;
}

export interface PointerInput {
  pon: PageObjectNumber;
  point: Vec;
  shift: boolean;
}

export type Msg =
  | { t: 'editPointer'; phase: 'down' | 'move' | 'up'; in: PointerInput }
  | { t: 'createPointer'; phase: 'down' | 'move' | 'up'; subtype: Subtype; in: PointerInput }
  | { t: 'deselect' }
  | { t: 'setStyle'; patch: Partial<Style> }
  | { t: 'setEndings'; patch: Partial<LineEndings> }
  | { t: 'setDefaults'; subtype: Subtype; patch: ToolDefaults }
  | { t: 'delete' }
  | { t: 'cancel' }
  | { t: 'loaded'; annots: Annot[] }
  | { t: 'created'; tempId: Id; id: Id; ref: AnnotationRef }
  | { t: 'createFailed'; tempId: Id };

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
  style: Style;
  source: 'baked' | 'vector' | 'ghost';
  selected: boolean;
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

export type ChromeNode =
  | { kind: 'outline'; rect: Rect }
  | { kind: 'handle'; at: Vec; cursor: Cursor }
  | { kind: 'marquee'; rect: Rect };
