import { z } from 'zod';

import type { AnnotationKindModule } from '../registry';
import { CircleKind } from './circle';
import { HighlightKind } from './highlight';
import { LineKind } from './line';
import { PolygonKind } from './polygon';
import { PolylineKind } from './polyline';
import { SquareKind } from './square';
import { SquigglyKind } from './squiggly';
import { StrikeoutKind } from './strikeout';
import { UnderlineKind } from './underline';
import { UnsupportedKind } from './unsupported';

export * from './highlight';
export * from './underline';
export * from './squiggly';
export * from './strikeout';
export * from './circle';
export * from './square';
export * from './polygon';
export * from './polyline';
export * from './line';
export * from './unsupported';
export * from './text-markup.shared';
export * from './shape.shared';
export * from './stroke-style.shared';
export * from './vertex.shared';

/**
 * The closed-world catalog of currently-implemented annotation kinds.
 *
 * Adding a new subtype is one folder under `kinds/<name>/` exporting the
 * five files (dto, draft, patch, schema, index) and one entry in this
 * tuple. The discriminated unions and zod discriminator below regenerate
 * automatically; no other file in the package needs to change.
 *
 * Every subtype the engine has not yet wired up rides on
 * `UnsupportedKind`. The wire format is stable: when a per-subtype reader
 * lands later, the engine starts emitting the dedicated DTO instead of
 * `unsupported`, and existing clients widen their handling without a
 * version bump.
 */
export const ANNOTATION_KINDS = [
  HighlightKind,
  UnderlineKind,
  SquigglyKind,
  StrikeoutKind,
  CircleKind,
  SquareKind,
  PolygonKind,
  PolylineKind,
  LineKind,
  UnsupportedKind,
] as const;

export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export type AnnotationSubtypeOfKind = AnnotationKind['subtype'];

/**
 * Lookup helper for the engine's reader catalog and identity resolver.
 * O(1) by `subtype` literal at runtime.
 */
export const KIND_BY_SUBTYPE: Readonly<{
  [K in AnnotationKind as K['subtype']]: K;
}> = Object.freeze(
  Object.fromEntries(ANNOTATION_KINDS.map((kind) => [kind.subtype, kind])) as Record<
    AnnotationSubtypeOfKind,
    AnnotationKind
  >,
) as Readonly<{ [K in AnnotationKind as K['subtype']]: K }>;

type DTOFromKind<K> =
  K extends AnnotationKindModule<infer _S, infer D, infer _Dr, infer _Pa> ? D : never;
type DraftFromKind<K> =
  K extends AnnotationKindModule<infer _S, infer _D, infer Dr, infer _Pa> ? Dr : never;
type PatchFromKind<K> =
  K extends AnnotationKindModule<infer _S, infer _D, infer _Dr, infer Pa> ? Pa : never;

/** Discriminated union over `subtype`, derived from the registry. */
export type AnnotationDTO = DTOFromKind<AnnotationKind>;

/**
 * Drafts that callers may pass to `create()`. `never` from
 * `UnsupportedKind` is dropped automatically by the union.
 */
export type AnnotationDraft = Exclude<DraftFromKind<AnnotationKind>, never>;

/** Patches that callers may pass to `update()`. */
export type AnnotationPatch = Exclude<PatchFromKind<AnnotationKind>, never>;

/**
 * Runtime zod schema for the discriminated union. The cast unwinds the
 * generic schema map into the specific tuple form `discriminatedUnion`
 * needs. Servers and cloud clients use this to validate every annotation
 * payload on the wire.
 */
export const AnnotationDTOSchema: z.ZodType<AnnotationDTO> = z.discriminatedUnion('subtype', [
  HighlightKind.dtoSchema,
  UnderlineKind.dtoSchema,
  SquigglyKind.dtoSchema,
  StrikeoutKind.dtoSchema,
  CircleKind.dtoSchema,
  SquareKind.dtoSchema,
  PolygonKind.dtoSchema,
  PolylineKind.dtoSchema,
  LineKind.dtoSchema,
  UnsupportedKind.dtoSchema,
] as unknown as [
  z.ZodDiscriminatedUnionOption<'subtype'>,
  ...z.ZodDiscriminatedUnionOption<'subtype'>[],
]) as unknown as z.ZodType<AnnotationDTO>;

export const AnnotationDraftSchema: z.ZodType<AnnotationDraft> = z.discriminatedUnion('subtype', [
  HighlightKind.draftSchema,
  UnderlineKind.draftSchema,
  SquigglyKind.draftSchema,
  StrikeoutKind.draftSchema,
  CircleKind.draftSchema,
  SquareKind.draftSchema,
  PolygonKind.draftSchema,
  PolylineKind.draftSchema,
  LineKind.draftSchema,
] as unknown as [
  z.ZodDiscriminatedUnionOption<'subtype'>,
  ...z.ZodDiscriminatedUnionOption<'subtype'>[],
]) as unknown as z.ZodType<AnnotationDraft>;

export const AnnotationPatchSchema: z.ZodType<AnnotationPatch> = z.discriminatedUnion('subtype', [
  HighlightKind.patchSchema,
  UnderlineKind.patchSchema,
  SquigglyKind.patchSchema,
  StrikeoutKind.patchSchema,
  CircleKind.patchSchema,
  SquareKind.patchSchema,
  PolygonKind.patchSchema,
  PolylineKind.patchSchema,
  LineKind.patchSchema,
] as unknown as [
  z.ZodDiscriminatedUnionOption<'subtype'>,
  ...z.ZodDiscriminatedUnionOption<'subtype'>[],
]) as unknown as z.ZodType<AnnotationPatch>;
