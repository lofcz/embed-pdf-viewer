import type { LinePoints, PdfRect } from '../../../geometry/primitives';
import type { AnnotationDraftBase } from '../../draft-base';
import type { LineEndings } from '../../primitives';
import type { StrokeFillDraftFields } from '../stroke-style.shared';

export interface LineDraft extends AnnotationDraftBase, StrokeFillDraftFields {
  subtype: 'line';
  /** `/L` the two endpoints — required. */
  linePoints: LinePoints;
  /** `/Rect` bounding box — required (computed by the caller/plugin). */
  rect: PdfRect;
  lineEndings?: LineEndings;
}
