import { decodeToken, encodeToken, type TokenInput, type TokenQuery } from './token';

export type { TokenInput } from './token';
import {
  AnnotationTokenSchema,
  ContentTokenSchema,
  DocTokenSchema,
  DownloadTokenSchema,
  LayoutTokenSchema,
  MetadataTokenSchema,
  RenderTokenSchema,
} from './tokenSchemas';
import type { PdfSaveMode } from '../dto/PdfSaveMode';

export interface DownloadToken {
  docVersion: number;
  mode: PdfSaveMode;
}

export const encodeDocToken = (docVersion: number): string =>
  encodeToken(DocTokenSchema, { docVersion });
export const decodeDocToken = (raw: string): number =>
  decodePositiveInteger(decodeToken(DocTokenSchema, raw).docVersion, 'docVersion');

export const encodeContentToken = (contentVersion: number): string =>
  encodeToken(ContentTokenSchema, { contentVersion });
export const decodeContentToken = (raw: string): number =>
  decodePositiveInteger(decodeToken(ContentTokenSchema, raw).contentVersion, 'contentVersion');

export const encodeLayoutToken = (layoutVersion: number): string =>
  encodeToken(LayoutTokenSchema, { layoutVersion });
export const decodeLayoutToken = (raw: string): number =>
  decodePositiveInteger(decodeToken(LayoutTokenSchema, raw).layoutVersion, 'layoutVersion');

export const encodeMetadataToken = (metadataVersion: number): string =>
  encodeToken(MetadataTokenSchema, { metadataVersion });
export const decodeMetadataToken = (raw: string): number =>
  decodePositiveInteger(decodeToken(MetadataTokenSchema, raw).metadataVersion, 'metadataVersion');

export const encodeAnnotationToken = (annotationVersion: number): string =>
  encodeToken(AnnotationTokenSchema, { annotationVersion });
export const decodeAnnotationToken = (raw: string): number =>
  decodePositiveInteger(
    decodeToken(AnnotationTokenSchema, raw).annotationVersion,
    'annotationVersion',
  );

export const encodeDownloadToken = (input: DownloadToken): string =>
  encodeToken(DownloadTokenSchema, { docVersion: input.docVersion, mode: input.mode });
export const decodeDownloadToken = (raw: string): DownloadToken => {
  const decoded = decodeToken(DownloadTokenSchema, raw);
  return {
    docVersion: decodePositiveInteger(decoded.docVersion, 'docVersion'),
    mode: decodePdfSaveMode(decoded.mode),
  };
};

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

function decodePdfSaveMode(raw: string | undefined): PdfSaveMode {
  if (raw === 'incremental' || raw === 'rewrite') return raw;
  throw new Error(`token field "mode" must be "incremental" or "rewrite"`);
}
