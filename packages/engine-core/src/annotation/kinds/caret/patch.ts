import type { PdfRect } from '../../../geometry/primitives';
import type { AnnotationPatchBase } from '../../patch-base';
import type { PdfRectDifferences } from '../../primitives';
import type { ColorStylePatchFields } from '../style.shared';

export interface CaretPatch extends AnnotationPatchBase, ColorStylePatchFields {
  subtype: 'caret';
  rect?: PdfRect;
  rectDifferences?: PdfRectDifferences;
}
