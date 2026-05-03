import type { AnnotationPatchBase } from '../../patch-base';
import type { TextMarkupPatchFields } from '../text-markup.shared';

export interface StrikeoutPatch extends AnnotationPatchBase, TextMarkupPatchFields {
  subtype: 'strikeout';
}
