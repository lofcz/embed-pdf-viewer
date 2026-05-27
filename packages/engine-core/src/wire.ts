/**
 * Zod-backed engine HTTP wire entrypoint.
 *
 * Cloud transports and server routes import this subpath when they need
 * runtime validation. Local/browser runtime code should use `/runtime`.
 */

export {
  DocumentMetadataSchema,
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
  RefetchReasonSchema,
  AnnotationListMutationMetaSchema,
  AnnotationCreateResultSchema,
  AnnotationUpdateResultSchema,
  AnnotationDeleteResultSchema,
  AnnotationMoveResultSchema,
  PageListSnapshotSchema,
  PageMoveInputSchema,
  PageMoveResultSchema,
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
export { cdnCoverageForScope, checkResourceAccess, DOC_RESOURCES } from './wire/resources';
export type {
  CapabilityRequirement,
  DocResourceDescriptor,
  DocResourceId,
  RouteKind,
} from './wire/resources';
export { decodeToken, encodeToken } from './wire/token';
export type { TokenInput, TokenQuery, TokenScalar, TokenSchema } from './wire/token';
export {
  AnnotationTokenSchema,
  ContentTokenSchema,
  DocTokenSchema,
  RenderTokenSchema,
} from './wire/tokenSchemas';
export {
  decodeAnnotationToken,
  decodeContentToken,
  decodeDocToken,
  decodeDownloadToken,
  decodeRenderToken,
  encodeAnnotationToken,
  encodeContentToken,
  encodeDocToken,
  encodeDownloadToken,
  encodeRenderToken,
} from './wire/tokens';
export type { DownloadToken } from './wire/tokens';
export { flatten, unflatten } from './wire/flatten';
export type { WireFlat, WireScalar } from './wire/flatten';
export {
  pageRenderOptionsFromImageOptions,
  renderImageOptionsToToken,
  renderImageOptionsToWire,
} from './wire/renderOptionsCodec';
export type { RenderVersions } from './wire/renderOptionsCodec';

export {
  AnnotationStableIdSchema,
  AnnotationRefSchema,
  RevisionTokenSchema,
  AnnotationFlagsSchema,
  ColorSchema,
  PointSchema,
  QuadPointSchema,
  RectSchema,
  LineEndingSchema,
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
  UnsupportedDTOSchema,
  UnsupportedDraftSchema,
  UnsupportedPatchSchema,
} from './annotation/kinds';
