import { decodeToken, encodeToken, type TokenInput, type TokenQuery } from './token';

export type { TokenInput } from './token';
import {
  AnnotationTokenSchema,
  ContentTokenSchema,
  DocTokenSchema,
  RenderTokenSchema,
} from './tokenSchemas';

export const encodeDocToken = (docVersion: number): string =>
  encodeToken(DocTokenSchema, { docVersion });
export const decodeDocToken = (raw: string): number =>
  decodePositiveInteger(decodeToken(DocTokenSchema, raw).docVersion, 'docVersion');

export const encodeContentToken = (contentVersion: number): string =>
  encodeToken(ContentTokenSchema, { contentVersion });
export const decodeContentToken = (raw: string): number =>
  decodePositiveInteger(decodeToken(ContentTokenSchema, raw).contentVersion, 'contentVersion');

export const encodeAnnotationToken = (annotationVersion: number): string =>
  encodeToken(AnnotationTokenSchema, { annotationVersion });
export const decodeAnnotationToken = (raw: string): number =>
  decodePositiveInteger(
    decodeToken(AnnotationTokenSchema, raw).annotationVersion,
    'annotationVersion',
  );

/**
 * Encode a render token from a flat wire-shape input. The input is the
 * output of `flatten(...)` over an SDK `PageImageOptions`-shaped object plus
 * cache versions. Semantic invariants (viewport-kind XOR fields,
 * includeAnnotations/annotationVersion consistency, target rect coherence)
 * live in `PageImageOptionsWireSchema` — running them here would duplicate
 * the spec.
 */
export const encodeRenderToken = (input: TokenInput): string =>
  encodeToken(RenderTokenSchema, input);

/**
 * Decode a render token to a flat `Record<string, string>` of allowed
 * fields. Use `unflatten(...)` + `PageImageOptionsWireSchema.parse(...)` to
 * recover the nested SDK shape with full coercion + validation.
 */
export const decodeRenderToken = (raw: string): TokenQuery => decodeToken(RenderTokenSchema, raw);

function decodePositiveInteger(raw: string | undefined, field: string): number {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new Error(`token field "${field}" must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`token field "${field}" must be a positive integer`);
  }
  return value;
}
