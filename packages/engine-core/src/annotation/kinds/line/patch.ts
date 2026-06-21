import type { LinePoints, PdfRect } from '../../../geometry/primitives';
import type { AnnotationPatchBase } from '../../patch-base';
import type { LineEndings } from '../../primitives';
import type { StrokeFillPatchFields } from '../stroke-style.shared';

export interface LinePatch extends AnnotationPatchBase, StrokeFillPatchFields {
  subtype: 'line';
  linePoints?: LinePoints;
  rect?: PdfRect;
  lineEndings?: LineEndings;
}
