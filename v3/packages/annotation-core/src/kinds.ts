/**
 * The annotation KIND table — the single declarative source for "what an
 * annotation of this subtype IS and what you can do to it". Pure DATA (no
 * closures), keyed by subtype, so it ports to Rust as a static table and replaces
 * the scattered `subtype`/`geom.t` switches and the old binary `EDITABLE_SUBTYPES`.
 *
 * Two layers meet here:
 *   • `variant` — which {@link Geom} primitive the kind renders/hit-tests as.
 *     Several subtypes share one (square+circle → `rect`, the markups → `quads`).
 *   • `caps` — ORTHOGONAL capability flags. "Editable" was one boolean that
 *     conflated selectable / movable / resizable / vertex-editable; splitting it
 *     is what lets text-markup be *selectable but not movable*, a note icon be
 *     *movable but not resizable*, and so on — without new code paths.
 *
 * Creation lives on TOOLS (a later layer), not here: many tools can target one
 * kind (ink vs ink-highlight, line vs arrow). A kind is the editing/identity
 * surface; a tool is the authoring surface.
 */
import type { Geom, Subtype } from './types';

/** Orthogonal capability flags. Static data — `locked` is the one runtime override
 *  (a locked annotation is never editable regardless of these). */
export interface KindCaps {
  /** Can be clicked to select. */
  selectable: boolean;
  /** Can be dragged (by its body) to translate. */
  movable: boolean;
  /** Exposes the 8 box resize handles (shapes). */
  resizable: boolean;
  /** Exposes per-vertex handles (line endpoints, polygon/polyline vertices). */
  vertexEditable: boolean;
  /** Can be rotated (stamp, free text). */
  rotatable: boolean;
  /** Carries editable text content (free text, the comment popup). */
  textEditable: boolean;
  /** Can carry a comment/note + threaded replies (`/Contents` + `/Popup`). */
  commentable: boolean;
  /** Has a popup as its primary surface (the comment/Text icon). */
  hasPopup: boolean;
  /** Bound to underlying text (markup, caret) — never freely moved/resized. */
  anchored: boolean;
  /** Has an interior fill (`/IC`). */
  hasFill: boolean;
  /** Has line endings (`/LE` — line, polyline). */
  hasEndings: boolean;
  /** Can take a cloudy border effect (`/BE` — shapes). */
  hasCloudy: boolean;
}

export interface AnnotationKind {
  subtype: Subtype;
  /** Future: PDF `/IT` intent (free-text vs callout, caret insert vs replace). */
  intent?: string;
  variant: Geom['t'];
  caps: KindCaps;
}

/** Build caps from a sparse override — everything not named is `false`. */
const caps = (c: Partial<KindCaps>): KindCaps => ({
  selectable: false,
  movable: false,
  resizable: false,
  vertexEditable: false,
  rotatable: false,
  textEditable: false,
  commentable: false,
  hasPopup: false,
  anchored: false,
  hasFill: false,
  hasEndings: false,
  hasCloudy: false,
  ...c,
});

/** Read-only fallback for unknown/unsupported subtypes (render baked, no editing). */
const READONLY: KindCaps = caps({});

/** The built-in kinds. Shapes resize, lines/polys vertex-edit, markup is anchored
 *  (selectable + recolor/delete, never move/resize). */
export const KINDS: Record<string, AnnotationKind> = {
  square: {
    subtype: 'square',
    variant: 'rect',
    caps: caps({
      selectable: true,
      movable: true,
      resizable: true,
      commentable: true,
      hasFill: true,
      hasCloudy: true,
    }),
  },
  circle: {
    subtype: 'circle',
    variant: 'rect',
    caps: caps({
      selectable: true,
      movable: true,
      resizable: true,
      commentable: true,
      hasFill: true,
      hasCloudy: true,
    }),
  },
  line: {
    subtype: 'line',
    variant: 'line',
    caps: caps({
      selectable: true,
      movable: true,
      vertexEditable: true,
      commentable: true,
      hasEndings: true,
    }),
  },
  polygon: {
    subtype: 'polygon',
    variant: 'poly',
    caps: caps({
      selectable: true,
      movable: true,
      vertexEditable: true,
      commentable: true,
      hasFill: true,
      hasCloudy: true,
    }),
  },
  polyline: {
    subtype: 'polyline',
    variant: 'poly',
    caps: caps({
      selectable: true,
      movable: true,
      vertexEditable: true,
      commentable: true,
      hasEndings: true,
    }),
  },
  // Ink: freehand strokes. Selectable + movable as a whole; no resize/vertex
  // handles in v1 (the strokes are the geometry). Created by a freehand drag.
  ink: {
    subtype: 'ink',
    variant: 'ink',
    caps: caps({ selectable: true, movable: true, commentable: true }),
  },
  // Text markup: selectable + anchored (bound to text — recolor/delete, never
  // move/resize). Created from a text selection, not a drag (see the markup tool).
  highlight: {
    subtype: 'highlight',
    variant: 'quads',
    caps: caps({ selectable: true, anchored: true, commentable: true }),
  },
  underline: {
    subtype: 'underline',
    variant: 'quads',
    caps: caps({ selectable: true, anchored: true, commentable: true }),
  },
  squiggly: {
    subtype: 'squiggly',
    variant: 'quads',
    caps: caps({ selectable: true, anchored: true, commentable: true }),
  },
  strikeout: {
    subtype: 'strikeout',
    variant: 'quads',
    caps: caps({ selectable: true, anchored: true, commentable: true }),
  },
};

/** The capabilities of a subtype, or the read-only default for unknown kinds. */
export const capsFor = (subtype: string): KindCaps => KINDS[subtype]?.caps ?? READONLY;
