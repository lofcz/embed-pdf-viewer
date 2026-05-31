import type { TokenSchema } from './token';

export const DocTokenSchema = {
  fields: ['docVersion'],
} as const satisfies TokenSchema;

export const ContentTokenSchema = {
  fields: ['contentVersion'],
} as const satisfies TokenSchema;

export const LayoutTokenSchema = {
  fields: ['layoutVersion'],
} as const satisfies TokenSchema;

export const MetadataTokenSchema = {
  fields: ['metadataVersion'],
} as const satisfies TokenSchema;

export const AnnotationTokenSchema = {
  fields: ['annotationVersion'],
} as const satisfies TokenSchema;

export const DownloadTokenSchema = {
  fields: ['docVersion', 'mode'],
  maxLength: 128,
} as const satisfies TokenSchema;

/**
 * Allowed flat keys for the render token, expressed as dotted paths that
 * mirror the SDK `PageImageOptions` shape 1:1. The token codec is fully
 * generic over this list — adding a new render option means adding its
 * dotted path here and a matching branch in `PageImageOptionsWireSchema`.
 * No encoder/decoder code changes.
 */
export const RenderTokenSchema = {
  fields: [
    'annotationVersion',
    'background',
    'contentVersion',
    'format',
    'includeAnnotations',
    'quality',
    'rotation',
    'target.kind',
    'target.rect.bottom',
    'target.rect.left',
    'target.rect.right',
    'target.rect.top',
    'viewport.kind',
    'viewport.scale',
    'viewport.width',
  ],
  maxLength: 512,
} as const satisfies TokenSchema;
