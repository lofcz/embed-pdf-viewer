import type { PdfRect } from '../../../geometry/primitives';
import type { AnnotationDraftBase } from '../../draft-base';
import type { PdfRectDifferences } from '../../primitives';
import type { ColorStyleDraftFields } from '../style.shared';

export interface CaretDraft extends AnnotationDraftBase, ColorStyleDraftFields {
  subtype: 'caret';
  /** `/Rect` bounding box — required (computed by the caller/plugin). */
  rect: PdfRect;
  /** `/RD` inset of the drawn caret from `/Rect`. */
  rectDifferences?: PdfRectDifferences;
}
