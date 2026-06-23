import type { InkList, PdfRect } from '../../../geometry/primitives';
import type { AnnotationDraftBase } from '../../draft-base';
import type { GeometryStyleDraftFields } from '../style.shared';

export interface InkDraft extends AnnotationDraftBase, GeometryStyleDraftFields {
  subtype: 'ink';
  /** `/InkList` — required (the freehand strokes). */
  inkList: InkList;
  /** `/Rect` bounding box — required (computed by the caller/plugin). */
  rect: PdfRect;
}
