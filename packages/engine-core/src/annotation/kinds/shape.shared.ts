import { z } from 'zod';
import type { AnnotationBase } from '../base';
import {
  AnnotationBaseShape,
  AnnotationBorderStyleSchema,
  ColorSchema,
  PdfRectDifferencesSchema,
} from '../base.schema';
import { PdfRectSchema } from '../../geometry/schemas';
import type { PdfRect } from '../../geometry/primitives';
import type { AnnotationBorderStyle, Color, PdfRectDifferences } from '../primitives';

/**
 * Shape-family-specific fields. The two shape subtypes (circle/square)
 * share their wire shape per ISO 32000 §12.5.6.8: they are `/Rect`-based
 * outlines with an interior fill (`/IC`), a stroke (`/C` + `/BS`), an
 * optional cloudy border effect (`/BE`), and optional rectangle
 * differences (`/RD`).
 *
 * Unlike the text-markup family (which derives `/Rect` from `quadPoints`),
 * shapes carry `/Rect` as their primary geometry — so the Draft requires
 * `rect` explicitly while the DTO inherits it from `AnnotationBase`.
 *
 * This file ONLY carries fields unique to the shape family.
 * Annotation-wide author-metadata (`contents`, `author`, `nm`) lives on
 * `AnnotationDraftBase` / `AnnotationPatchBase`.
 */
export interface ShapeAnnotationFields {
  /** `/IC` interior (fill) color. `null` when the shape has no fill. */
  interiorColor: Color | null;
  /** `/C` border (stroke) color. */
  strokeColor: Color;
  /** `/BS /W` border width, in PDF points. */
  strokeWidth: number;
  /** `/BS /S` border style. */
  borderStyle: AnnotationBorderStyle;
  /** `/CA` constant opacity, 0..1. */
  opacity: number;
  /** `/BS /D` dash pattern. Only meaningful when `borderStyle === 'dashed'`. */
  dashArray?: number[];
  /** `/BE` cloudy border intensity. Absent/0 means a plain (non-cloudy) border. */
  cloudyIntensity?: number;
  /** `/RD` rectangle differences (inset of drawn geometry from `/Rect`). */
  rectDifferences?: PdfRectDifferences;
}

export interface ShapeDraftFields {
  /** `/Rect` geometry — required for shapes (they are not derived from quads). */
  rect: PdfRect;
  interiorColor?: Color | null;
  strokeColor?: Color;
  strokeWidth?: number;
  borderStyle?: AnnotationBorderStyle;
  opacity?: number;
  dashArray?: number[];
  cloudyIntensity?: number;
  rectDifferences?: PdfRectDifferences;
}

export interface ShapePatchFields {
  rect?: PdfRect;
  interiorColor?: Color | null;
  strokeColor?: Color;
  strokeWidth?: number;
  borderStyle?: AnnotationBorderStyle;
  opacity?: number;
  dashArray?: number[];
  cloudyIntensity?: number;
  rectDifferences?: PdfRectDifferences;
}

export const ShapeDTOShape = {
  ...AnnotationBaseShape,
  interiorColor: ColorSchema.nullable(),
  strokeColor: ColorSchema,
  strokeWidth: z.number().nonnegative(),
  borderStyle: AnnotationBorderStyleSchema,
  opacity: z.number().min(0).max(1),
  dashArray: z.array(z.number().nonnegative()).optional(),
  cloudyIntensity: z.number().nonnegative().optional(),
  rectDifferences: PdfRectDifferencesSchema.optional(),
} as const;

export const ShapeDraftShape = {
  rect: PdfRectSchema,
  interiorColor: ColorSchema.nullable().optional(),
  strokeColor: ColorSchema.optional(),
  strokeWidth: z.number().nonnegative().optional(),
  borderStyle: AnnotationBorderStyleSchema.optional(),
  opacity: z.number().min(0).max(1).optional(),
  dashArray: z.array(z.number().nonnegative()).optional(),
  cloudyIntensity: z.number().nonnegative().optional(),
  rectDifferences: PdfRectDifferencesSchema.optional(),
} as const;

export const ShapePatchShape = {
  rect: PdfRectSchema.optional(),
  interiorColor: ColorSchema.nullable().optional(),
  strokeColor: ColorSchema.optional(),
  strokeWidth: z.number().nonnegative().optional(),
  borderStyle: AnnotationBorderStyleSchema.optional(),
  opacity: z.number().min(0).max(1).optional(),
  dashArray: z.array(z.number().nonnegative()).optional(),
  cloudyIntensity: z.number().nonnegative().optional(),
  rectDifferences: PdfRectDifferencesSchema.optional(),
} as const;

/** Glue type used by each shape kind file to construct its concrete DTO. */
export type ShapeDTO<S extends string> = AnnotationBase & {
  subtype: S;
} & ShapeAnnotationFields;
