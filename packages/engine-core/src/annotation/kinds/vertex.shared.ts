import { z } from 'zod';

import {
  StrokeFillDTOShape,
  StrokeFillDraftShape,
  StrokeFillPatchShape,
  type StrokeFillDraftFields,
  type StrokeFillFields,
  type StrokeFillPatchFields,
} from './stroke-style.shared';
import type { PdfPoint, PdfRect } from '../../geometry/primitives';
import { PdfPointSchema } from '../../geometry/schemas';
import { PdfRectSchema } from '../../geometry/schemas';
import type { AnnotationBase } from '../base';
import { AnnotationBaseShape } from '../base.schema';

/**
 * Vertex-family-specific fields. The two vertex subtypes (polygon/polyline)
 * carry their geometry as a `/Vertices` point list (ISO 32000 §12.5.6.9)
 * plus the common stroke/fill styling ({@link StrokeFillFields}). Polygon
 * layers cloudy borders (`/BE`) + rectangle differences (`/RD`) on top;
 * polyline layers line endings (`/LE`); each kind file adds those.
 *
 * Like shapes, the engine takes an explicit `/Rect` on the Draft (the v3
 * plugin owns the bounding-box + rotation math, so the engine stays a
 * faithful persistence layer); the DTO inherits `rect` from
 * `AnnotationBase`.
 */
export interface VertexAnnotationFields extends StrokeFillFields {
  /** `/Vertices` — the ordered point list (PDF user space, y-up). */
  vertices: PdfPoint[];
}

export interface VertexDraftFields extends StrokeFillDraftFields {
  /** `/Vertices` geometry — required (vertex annotations are not derived). */
  vertices: PdfPoint[];
  /** `/Rect` bounding box — required (computed by the caller/plugin). */
  rect: PdfRect;
}

export interface VertexPatchFields extends StrokeFillPatchFields {
  vertices?: PdfPoint[];
  rect?: PdfRect;
}

export const VertexDTOShape = {
  ...AnnotationBaseShape,
  ...StrokeFillDTOShape,
  vertices: z.array(PdfPointSchema),
} as const;

export const VertexDraftShape = {
  ...StrokeFillDraftShape,
  vertices: z.array(PdfPointSchema),
  rect: PdfRectSchema,
} as const;

export const VertexPatchShape = {
  ...StrokeFillPatchShape,
  vertices: z.array(PdfPointSchema).optional(),
  rect: PdfRectSchema.optional(),
} as const;

/** Glue type used by each vertex kind file to construct its concrete DTO. */
export type VertexDTO<S extends string> = AnnotationBase & {
  subtype: S;
} & VertexAnnotationFields;
