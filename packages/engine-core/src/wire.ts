/**
 * Zod-backed engine HTTP wire entrypoint.
 *
 * Cloud transports and server routes import this subpath when they need
 * runtime validation. Local/browser runtime code should use `/runtime`.
 */

export {
  DocumentMetadataSchema,
  MetadataPatchSchema,
  MetadataUpdateResultSchema,
  AccessRequestSchema,
  AccessResponseSchema,
  OpenDocumentResponseSchema,
  DocumentHeadSchema,
  DocumentSecurityStateSchema,
  PdfSaveModeSchema,
  DocumentManifestSchema,
  ManifestPageSchema,
  CachePinsSchema,
  CacheDeltaSchema,
  MutationMetaSchema,
  EngineErrorPayloadSchema,
  PageStateSchema,
  AnnotationListPageSnapshotSchema,
  AnnotationListSnapshotAllPagesSchema,
  PageTextSnapshotSchema,
  PageGeometrySnapshotSchema,
  PageNetworkRenderFormatSchema,
  PageRenderQuerySchema,
  AnnotationAppearancesQuerySchema,
  AnnotationAppearanceManifestSchema,
  RefetchReasonSchema,
  AnnotationListMutationMetaSchema,
  AnnotationCreateResultSchema,
  AnnotationUpdateResultSchema,
  AnnotationDeleteResultSchema,
  AnnotationMoveResultSchema,
  PageListSnapshotSchema,
  PageLayoutSchema,
  PageBoxesSchema,
  PageMoveInputSchema,
  PageMoveResultSchema,
  PageStructureCacheSchema,
  PageRotateInputSchema,
  PageRotateResultSchema,
  PageDeleteInputSchema,
  PageDeleteResultSchema,
  WeakAnnotationSessionResponseSchema,
  WeakAnnotationSessionPagesRequestSchema,
} from './wire/schemas';
export type {
  OpenDocumentResponse,
  AccessRequest,
  AccessResponse,
  DocumentHead,
  DocumentManifest,
  ManifestPage,
  CacheDelta,
  MutationMeta,
  WeakAnnotationSessionResponse,
  WeakAnnotationSessionPagesRequest,
} from './wire/schemas';
export { DEFAULT_LAYER_NAME, wirePaths } from './wire/paths';
// General resource catalog + route-guard helper (server uses this for
// every read endpoint, not just CDN-cacheable ones).
export { checkResourceAccess, DOC_RESOURCES } from './wire/resources';
export type {
  CapabilityRequirement,
  DocResourceDescriptor,
  DocResourceId,
  RouteKind,
} from './wire/resources';

// CDN-shaped surface — coverage enumeration + per-request URL
// application. Scoped under wire/cdn/ so the boundary stays loud (see
// wire/cdn/index.ts for the contract). Re-exported here for ergonomic
// imports from `@embedpdf/engine-core/wire`; consumers wanting the
// narrower import path can use `@embedpdf/engine-core/wire/cdn`
// directly when that entry is published.
export { applyCdnAccess, cdnCoverageForScope, resolveResourceIdForPath } from './wire/cdn';
export type {
  ApplyCdnAccessInput,
  ApplyCdnAccessResult,
  CdnAccessInfoForApply,
  CdnCoverageEntry,
} from './wire/cdn';
export { decodeToken, encodeToken } from './wire/token';
export type { TokenInput, TokenQuery, TokenScalar, TokenSchema } from './wire/token';
export {
  AnnotationAppearancesRenderTokenSchema,
  AnnotationTokenSchema,
  ContentTokenSchema,
  DocTokenSchema,
  LayoutTokenSchema,
  MetadataTokenSchema,
  RenderTokenSchema,
} from './wire/tokenSchemas';
export {
  decodeAnnotationAppearancesRenderToken,
  decodeAnnotationToken,
  decodeContentToken,
  decodeDocToken,
  decodeDownloadToken,
  decodeLayoutToken,
  decodeMetadataToken,
  decodeRenderToken,
  encodeAnnotationAppearancesRenderToken,
  encodeAnnotationToken,
  encodeContentToken,
  encodeDocToken,
  encodeDownloadToken,
  encodeLayoutToken,
  encodeMetadataToken,
  encodeRenderToken,
} from './wire/tokens';
export type { DownloadToken } from './wire/tokens';
export { flatten, unflatten } from './wire/flatten';
export type { WireFlat, WireScalar } from './wire/flatten';
export {
  annotationAppearancesImageOptionsToToken,
  annotationAppearancesImageOptionsToWire,
  annotationRenderOptionsFromImageOptions,
  pageRenderOptionsFromImageOptions,
  renderImageOptionsToToken,
  renderImageOptionsToWire,
} from './wire/renderOptionsCodec';
export type { AnnotationRenderVersion, RenderVersions } from './wire/renderOptionsCodec';

// Canonical PDF-document geometry schemas (zod). Exported from `wire` ONLY.
export {
  PdfPointSchema,
  PdfRectSchema,
  PdfSizeSchema,
  PdfQuadSchema,
  PdfRotationSchema,
} from './geometry/schemas';

export {
  AnnotationStableIdSchema,
  AnnotationRefSchema,
  RevisionTokenSchema,
  AnnotationFlagsSchema,
  ColorSchema,
  PointSchema,
  RectSchema,
  LineEndingSchema,
  AnnotationBorderStyleSchema,
  PdfRectDifferencesSchema,
  AnnotationBaseShape,
  AnnotationDraftBaseShape,
  AnnotationPatchBaseShape,
} from './annotation/base.schema';

export {
  ANNOTATION_KINDS,
  KIND_BY_SUBTYPE,
  AnnotationDTOSchema,
  AnnotationDraftSchema,
  AnnotationPatchSchema,
  HighlightDTOSchema,
  HighlightDraftSchema,
  HighlightPatchSchema,
  UnderlineDTOSchema,
  UnderlineDraftSchema,
  UnderlinePatchSchema,
  SquigglyDTOSchema,
  SquigglyDraftSchema,
  SquigglyPatchSchema,
  StrikeoutDTOSchema,
  StrikeoutDraftSchema,
  StrikeoutPatchSchema,
  CircleDTOSchema,
  CircleDraftSchema,
  CirclePatchSchema,
  SquareDTOSchema,
  SquareDraftSchema,
  SquarePatchSchema,
  UnsupportedDTOSchema,
  UnsupportedDraftSchema,
  UnsupportedPatchSchema,
} from './annotation/kinds';
