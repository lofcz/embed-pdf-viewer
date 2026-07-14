/**
 * The default tool-badge glyph: a miniature of what the tool draws, as pure
 * GEOMETRY in an arbitrary box. The framework renders it through the same
 * `scene()` painter as every annotation — so the glyph's color/fill/endings
 * track the tool's live defaults with zero framework-specific drawing code.
 * Apps that want toolbar-identical badges render their own icon instead (the
 * badge renderer slot); this is the zero-config fallback.
 */
import type { AnnotationProps, Geom, Rect, Subtype, Vec } from './types';

const inset = (b: Rect, by: number): Rect => ({
  x: b.x + by,
  y: b.y + by,
  width: Math.max(1, b.width - 2 * by),
  height: Math.max(1, b.height - 2 * by),
});

const at = (b: Rect, fx: number, fy: number): Vec => ({
  x: b.x + b.width * fx,
  y: b.y + b.height * fy,
});

/**
 * Miniature geometry for a tool's routing subtype inside `box`. Unknown
 * subtypes fall back to a plain rect — a custom kind still gets a badge.
 */
export function badgeGeom(subtype: Subtype, box: Rect, def: AnnotationProps): Geom {
  const b = inset(box, Math.min(box.width, box.height) * 0.12);
  switch (subtype) {
    case 'circle':
      return { t: 'rect', rect: b, ellipse: true };
    case 'line':
      return { t: 'line', a: at(b, 0, 1), b: at(b, 1, 0), ends: def.lineEndings };
    case 'polygon':
      return {
        t: 'poly',
        points: [at(b, 0.5, 0), at(b, 1, 0.4), at(b, 0.8, 1), at(b, 0.2, 1), at(b, 0, 0.4)],
        closed: true,
      };
    case 'polyline':
      return {
        t: 'poly',
        points: [at(b, 0, 1), at(b, 0.33, 0.25), at(b, 0.66, 0.75), at(b, 1, 0)],
        closed: false,
        ends: def.lineEndings,
      };
    case 'ink': {
      // A small S-stroke — enough to read as freehand at 18px.
      const pts: Vec[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push({
          x: b.x + b.width * t,
          y: b.y + b.height * (0.5 - 0.42 * Math.sin(t * Math.PI * 1.5)),
        });
      }
      return { t: 'ink', strokes: [pts] };
    }
    // `scene()` paints geometry, not text — a bordered box reads as "text box"
    // at badge size (the glyph slot exists for apps that want a real icon).
    case 'free-text':
    case 'free-text-callout':
    case 'square':
    default:
      return { t: 'rect', rect: b, ellipse: false };
  }
}
