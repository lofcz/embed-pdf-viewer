import { z } from 'zod';

import { AnnotationBorderStyleSchema, ColorSchema } from '../base.schema';
import type { AnnotationBorderStyle, Color } from '../primitives';

/**
 * Stroke + fill styling shared by every geometric annotation family —
 * shapes (circle/square), vertex annotations (polygon/polyline), and the
 * line annotation. Per ISO 32000 these all carry an interior fill (`/IC`),
 * a stroke colour (`/C`), a border style + width (`/BS`), constant opacity
 * (`/CA`), and an optional dash pattern (`/BS /D`).
 *
 * This module ONLY carries those common styling fields. Geometry
 * (`/Rect`, `/Vertices`, `/L`), cloudy borders (`/BE`), rectangle
 * differences (`/RD`), and line endings (`/LE`) are layered on by the
 * per-family shared modules so each family stays a precise type.
 */
export interface StrokeFillFields {
  /** `/IC` interior (fill) color. `null` when the annotation has no fill. */
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
}

export interface StrokeFillDraftFields {
  interiorColor?: Color | null;
  strokeColor?: Color;
  strokeWidth?: number;
  borderStyle?: AnnotationBorderStyle;
  opacity?: number;
  dashArray?: number[];
}

export type StrokeFillPatchFields = StrokeFillDraftFields;

export const StrokeFillDTOShape = {
  interiorColor: ColorSchema.nullable(),
  strokeColor: ColorSchema,
  strokeWidth: z.number().nonnegative(),
  borderStyle: AnnotationBorderStyleSchema,
  opacity: z.number().min(0).max(1),
  dashArray: z.array(z.number().nonnegative()).optional(),
} as const;

export const StrokeFillDraftShape = {
  interiorColor: ColorSchema.nullable().optional(),
  strokeColor: ColorSchema.optional(),
  strokeWidth: z.number().nonnegative().optional(),
  borderStyle: AnnotationBorderStyleSchema.optional(),
  opacity: z.number().min(0).max(1).optional(),
  dashArray: z.array(z.number().nonnegative()).optional(),
} as const;

export const StrokeFillPatchShape = StrokeFillDraftShape;
