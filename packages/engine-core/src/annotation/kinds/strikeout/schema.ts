import { z } from 'zod';
import { AnnotationDraftBaseShape, AnnotationPatchBaseShape } from '../../base.schema';
import {
  TextMarkupDTOShape,
  TextMarkupDraftShape,
  TextMarkupPatchShape,
} from '../text-markup.shared';
import type { StrikeoutAnnotationDTO } from './dto';
import type { StrikeoutDraft } from './draft';
import type { StrikeoutPatch } from './patch';

export const StrikeoutDTOSchema: z.ZodType<StrikeoutAnnotationDTO> = z.object({
  ...TextMarkupDTOShape,
  subtype: z.literal('strikeout'),
}) as unknown as z.ZodType<StrikeoutAnnotationDTO>;

export const StrikeoutDraftSchema: z.ZodType<StrikeoutDraft> = z.object({
  ...TextMarkupDraftShape,
  ...AnnotationDraftBaseShape,
  subtype: z.literal('strikeout'),
});

export const StrikeoutPatchSchema: z.ZodType<StrikeoutPatch> = z.object({
  ...TextMarkupPatchShape,
  ...AnnotationPatchBaseShape,
  subtype: z.literal('strikeout'),
});
