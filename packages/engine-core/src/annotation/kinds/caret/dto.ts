import type { AnnotationBase } from '../../base';
import type { PdfRectDifferences } from '../../primitives';
import type { ColorStyleFields } from '../style.shared';

/**
 * Caret annotation — a visual marker for a proposed text insertion or edit
 * point. It carries no geometry of its own beyond `/Rect`: just a `/C` color,
 * `/CA` opacity, and an optional `/RD` inset of the drawn symbol from `/Rect`.
 */
export type CaretAnnotationDTO = AnnotationBase &
  ColorStyleFields & {
    subtype: 'caret';
    /** `/RD` inset of the drawn caret from `/Rect`. */
    rectDifferences?: PdfRectDifferences;
  };
