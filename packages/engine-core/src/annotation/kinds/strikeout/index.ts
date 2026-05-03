import type { AnnotationKindModule } from '../../registry';
import { PdfAnnotationSubtypeCode } from '../../subtype';
import type { StrikeoutAnnotationDTO } from './dto';
import type { StrikeoutDraft } from './draft';
import type { StrikeoutPatch } from './patch';
import { StrikeoutDTOSchema, StrikeoutDraftSchema, StrikeoutPatchSchema } from './schema';

export type { StrikeoutAnnotationDTO } from './dto';
export type { StrikeoutDraft } from './draft';
export type { StrikeoutPatch } from './patch';
export { StrikeoutDTOSchema, StrikeoutDraftSchema, StrikeoutPatchSchema } from './schema';

export const StrikeoutKind: AnnotationKindModule<
  'strikeout',
  StrikeoutAnnotationDTO,
  StrikeoutDraft,
  StrikeoutPatch
> = {
  subtype: 'strikeout',
  pdfSubtypeCode: PdfAnnotationSubtypeCode.STRIKEOUT,
  dtoSchema: StrikeoutDTOSchema,
  draftSchema: StrikeoutDraftSchema,
  patchSchema: StrikeoutPatchSchema,
};
