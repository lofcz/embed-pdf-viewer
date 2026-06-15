import { z } from 'zod';
import type { AnnotationBase } from '../base';
import { AnnotationBaseShape, ColorSchema } from '../base.schema';
import { PdfQuadSchema } from '../../geometry/schemas';
import type { PdfQuad } from '../../geometry/primitives';
import type { Color } from '../primitives';

/**
 * Text-markup family-specific fields. The four text-markup subtypes
 * (highlight/underline/squiggly/strikeout) share their wire shape per
 * ISO 32000 12.5.6.10: `color` (RGB), `opacity` (/CA), and one or more
 * `quadPoints` quads.
 *
 * This file ONLY carries fields that are unique to the text-markup
 * family. Annotation-wide author-metadata (`contents`, `author`, `nm`)
 * lives on `AnnotationDraftBase` / `AnnotationPatchBase`. Each kind's
 * draft/patch type composes the two: family fields + base fields +
 * own `subtype` literal.
 */
export interface TextMarkupAnnotationFields {
  color: Color;
  opacity: number;
  quadPoints: PdfQuad[];
}

export interface TextMarkupDraftFields {
  color?: Color;
  opacity?: number;
  quadPoints: PdfQuad[];
}

export interface TextMarkupPatchFields {
  color?: Color;
  opacity?: number;
  quadPoints?: PdfQuad[];
}

export const TextMarkupDTOShape = {
  ...AnnotationBaseShape,
  color: ColorSchema,
  opacity: z.number().min(0).max(1),
  quadPoints: z.array(PdfQuadSchema),
} as const;

export const TextMarkupDraftShape = {
  color: ColorSchema.optional(),
  opacity: z.number().min(0).max(1).optional(),
  quadPoints: z.array(PdfQuadSchema),
} as const;

export const TextMarkupPatchShape = {
  color: ColorSchema.optional(),
  opacity: z.number().min(0).max(1).optional(),
  quadPoints: z.array(PdfQuadSchema).optional(),
} as const;

/** Glue type used by each kind file to construct its concrete DTO. */
export type TextMarkupDTO<S extends string> = AnnotationBase & {
  subtype: S;
} & TextMarkupAnnotationFields;
