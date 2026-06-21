import { z } from 'zod';
import type {
  AnnotationBorderStyle,
  AnnotationFlags,
  Color,
  LineEnding,
  PdfRectDifferences,
} from './primitives';
import type { AnnotationBase } from './base';
import { PdfPointSchema, PdfRectSchema, PdfQuadSchema } from '../geometry/schemas';
import type { AnnotationStableId } from '../identity/AnnotationStableId';
import type { AnnotationRef } from '../identity/AnnotationRef';
import type { RevisionToken } from '../revision/RevisionToken';

/** @deprecated Use `PdfPointSchema` from `../geometry/schemas`. */
export const PointSchema = PdfPointSchema;
/** @deprecated Use `PdfRectSchema` from `../geometry/schemas`. */
export const RectSchema = PdfRectSchema;

export const ColorSchema: z.ZodType<Color> = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
  a: z.number().min(0).max(1).optional(),
});

export const AnnotationBorderStyleSchema: z.ZodType<AnnotationBorderStyle> = z.enum([
  'solid',
  'dashed',
  'beveled',
  'inset',
]);

export const PdfRectDifferencesSchema: z.ZodType<PdfRectDifferences> = z.object({
  left: z.number().nonnegative(),
  top: z.number().nonnegative(),
  right: z.number().nonnegative(),
  bottom: z.number().nonnegative(),
});

export const LineEndingSchema: z.ZodType<LineEnding> = z.enum([
  'none',
  'square',
  'circle',
  'diamond',
  'open-arrow',
  'closed-arrow',
  'butt',
  'r-open-arrow',
  'r-closed-arrow',
  'slash',
]);

export const AnnotationFlagsSchema: z.ZodType<AnnotationFlags> = z.object({
  invisible: z.boolean(),
  hidden: z.boolean(),
  print: z.boolean(),
  noZoom: z.boolean(),
  noRotate: z.boolean(),
  noView: z.boolean(),
  readOnly: z.boolean(),
  locked: z.boolean(),
  toggleNoView: z.boolean(),
  lockedContents: z.boolean(),
});

export const AnnotationStableIdSchema: z.ZodType<AnnotationStableId> = z.discriminatedUnion(
  'kind',
  [
    z.object({ kind: z.literal('objectNumber'), value: z.number().int().nonnegative() }),
    z.object({ kind: z.literal('nm'), value: z.string() }),
  ],
);

export const RevisionTokenSchema: z.ZodType<RevisionToken> = z.object({
  docSessionId: z.string(),
  pageObjectNumber: z.number().int().positive(),
  generation: z.number().int().nonnegative(),
});

export const AnnotationRefSchema: z.ZodType<AnnotationRef> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('objectNumber'),
    pageObjectNumber: z.number().int().positive(),
    annotObjectNumber: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('nm'),
    pageObjectNumber: z.number().int().positive(),
    nm: z.string(),
  }),
  z.object({
    kind: z.literal('index'),
    pageObjectNumber: z.number().int().positive(),
    index: z.number().int().nonnegative(),
    revision: RevisionTokenSchema,
  }),
]);

/**
 * Shared object literal for every per-subtype DTO schema. Each kind's
 * `dto.schema.ts` extends this with its own `subtype` literal and
 * subtype-specific fields. Note that we do NOT include `subtype` here —
 * each kind sets its own literal so `z.discriminatedUnion('subtype', ...)`
 * works at the catalog level.
 */
export const AnnotationBaseShape = {
  ref: AnnotationRefSchema,
  pageObjectNumber: z.number().int().positive(),
  index: z.number().int().nonnegative(),
  identityQuality: z.enum(['durable', 'weak']),
  nm: z.string().nullable(),
  flags: AnnotationFlagsSchema,
  rect: PdfRectSchema,
  contents: z.string().nullable(),
  author: z.string().nullable(),
  created: z.string().datetime().nullable(),
  modified: z.string().datetime().nullable(),
  // EmbedPDF /EMBD_Metadata fields — see AnnotationBase docstring.
  // Optional (absent for legacy or anonymous annotations) and never
  // null on the wire: present-as-string or absent entirely.
  userId: z.string().optional(),
  groupId: z.string().optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
} as const;

/**
 * Annotation-wide fields shared by every Draft. Per-kind draft schemas
 * spread this alongside their family-specific shape.
 *
 * Authorial identity (/T, /EMBD_Metadata UserID/GroupID) is set by the
 * server from the caller's JWT identity — see the AnnotationDraftBase
 * docstring.
 */
export const AnnotationDraftBaseShape = {
  contents: z.string().nullable().optional(),
  nm: z.string().optional(),
} as const;

/**
 * Annotation-wide fields shared by every Patch. `nm` is monotonic per
 * annotation; clients target an existing annotation via AnnotationRef
 * instead of renaming.
 *
 * `groupId` is the only identity-shaped field on a patch — it
 * represents organizational ownership, and reassignment runs through
 * `checkSetGroup`. See AnnotationPatchBase for the full immutability
 * rules.
 */
export const AnnotationPatchBaseShape = {
  contents: z.string().nullable().optional(),
  groupId: z.string().min(1).optional(),
} as const;

/** Helper that asserts `BasePart extends AnnotationBase` without subtype. */
export type AnnotationBaseSansSubtype = Omit<AnnotationBase, 'subtype' | 'ref'> & {
  ref: AnnotationRef;
};
