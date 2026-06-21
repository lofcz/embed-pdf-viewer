import { z } from 'zod';

import { LinePointsSchema, PdfRectSchema } from '../../../geometry/schemas';
import {
  AnnotationBaseShape,
  AnnotationDraftBaseShape,
  AnnotationPatchBaseShape,
  LineEndingsSchema,
} from '../../base.schema';
import {
  StrokeFillDTOShape,
  StrokeFillDraftShape,
  StrokeFillPatchShape,
} from '../stroke-style.shared';
import type { LineDraft } from './draft';
import type { LineAnnotationDTO } from './dto';
import type { LinePatch } from './patch';

export const LineDTOSchema: z.ZodType<LineAnnotationDTO> = z.object({
  ...AnnotationBaseShape,
  ...StrokeFillDTOShape,
  linePoints: LinePointsSchema,
  lineEndings: LineEndingsSchema,
  subtype: z.literal('line'),
}) as unknown as z.ZodType<LineAnnotationDTO>;

export const LineDraftSchema: z.ZodType<LineDraft> = z.object({
  ...StrokeFillDraftShape,
  ...AnnotationDraftBaseShape,
  linePoints: LinePointsSchema,
  rect: PdfRectSchema,
  lineEndings: LineEndingsSchema.optional(),
  subtype: z.literal('line'),
});

export const LinePatchSchema: z.ZodType<LinePatch> = z.object({
  ...StrokeFillPatchShape,
  ...AnnotationPatchBaseShape,
  linePoints: LinePointsSchema.optional(),
  rect: PdfRectSchema.optional(),
  lineEndings: LineEndingsSchema.optional(),
  subtype: z.literal('line'),
});
