import type { InkList, PdfRect } from '../../../geometry/primitives';
import type { AnnotationPatchBase } from '../../patch-base';
import type { GeometryStylePatchFields } from '../style.shared';

export interface InkPatch extends AnnotationPatchBase, GeometryStylePatchFields {
  subtype: 'ink';
  inkList?: InkList;
  rect?: PdfRect;
}
