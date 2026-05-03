import type { AnnotationDraftBase } from '../../draft-base';
import type { TextMarkupDraftFields } from '../text-markup.shared';

export interface StrikeoutDraft extends AnnotationDraftBase, TextMarkupDraftFields {
  subtype: 'strikeout';
}
