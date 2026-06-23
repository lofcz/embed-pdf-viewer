import { z } from 'zod';

import { CalloutLineSchema, PdfRectSchema } from '../../../geometry/schemas';
import {
  AnnotationBaseShape,
  AnnotationBorderStyleSchema,
  AnnotationDraftBaseShape,
  AnnotationPatchBaseShape,
  ColorSchema,
  FreeTextIntentSchema,
  LineEndingSchema,
  PdfRectDifferencesSchema,
  StandardFontSchema,
  TextAlignmentSchema,
} from '../../base.schema';
import type { FreeTextDraft } from './draft';
import type { FreeTextAnnotationDTO } from './dto';
import type { FreeTextPatch } from './patch';

export const FreeTextDTOSchema: z.ZodType<FreeTextAnnotationDTO> = z.object({
  ...AnnotationBaseShape,
  intent: FreeTextIntentSchema,
  fontFamily: StandardFontSchema,
  fontSize: z.number().positive(),
  textAlign: TextAlignmentSchema,
  color: ColorSchema,
  fontColor: ColorSchema.optional(),
  interiorColor: ColorSchema.nullable(),
  opacity: z.number().min(0).max(1),
  strokeWidth: z.number().nonnegative(),
  borderStyle: AnnotationBorderStyleSchema,
  dashArray: z.array(z.number().nonnegative()).optional(),
  rectDifferences: PdfRectDifferencesSchema.optional(),
  calloutLine: CalloutLineSchema.optional(),
  lineEnding: LineEndingSchema.optional(),
  subtype: z.literal('free-text'),
}) as unknown as z.ZodType<FreeTextAnnotationDTO>;

export const FreeTextDraftSchema: z.ZodType<FreeTextDraft> = z.object({
  ...AnnotationDraftBaseShape,
  intent: FreeTextIntentSchema,
  fontFamily: StandardFontSchema,
  fontSize: z.number().positive(),
  textAlign: TextAlignmentSchema,
  rect: PdfRectSchema,
  color: ColorSchema.optional(),
  fontColor: ColorSchema.optional(),
  interiorColor: ColorSchema.nullable().optional(),
  opacity: z.number().min(0).max(1).optional(),
  strokeWidth: z.number().nonnegative().optional(),
  borderStyle: AnnotationBorderStyleSchema.optional(),
  dashArray: z.array(z.number().nonnegative()).optional(),
  rectDifferences: PdfRectDifferencesSchema.optional(),
  calloutLine: CalloutLineSchema.optional(),
  lineEnding: LineEndingSchema.optional(),
  subtype: z.literal('free-text'),
});

export const FreeTextPatchSchema: z.ZodType<FreeTextPatch> = z.object({
  ...AnnotationPatchBaseShape,
  intent: FreeTextIntentSchema.optional(),
  fontFamily: StandardFontSchema.optional(),
  fontSize: z.number().positive().optional(),
  textAlign: TextAlignmentSchema.optional(),
  rect: PdfRectSchema.optional(),
  color: ColorSchema.optional(),
  fontColor: ColorSchema.optional(),
  interiorColor: ColorSchema.nullable().optional(),
  opacity: z.number().min(0).max(1).optional(),
  strokeWidth: z.number().nonnegative().optional(),
  borderStyle: AnnotationBorderStyleSchema.optional(),
  dashArray: z.array(z.number().nonnegative()).optional(),
  rectDifferences: PdfRectDifferencesSchema.optional(),
  calloutLine: CalloutLineSchema.optional(),
  lineEnding: LineEndingSchema.optional(),
  subtype: z.literal('free-text'),
});
