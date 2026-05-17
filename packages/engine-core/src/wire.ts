/**
 * Zod-backed engine HTTP wire entrypoint.
 *
 * Cloud transports and server routes import this subpath when they need
 * runtime validation. Local/browser runtime code should use `/runtime`.
 */

export {
  DocumentMetadataSchema,
  OpenDocumentResponseSchema,
  DocumentHeadSchema,
  DocumentManifestSchema,
  ManifestPageSchema,
  EngineErrorPayloadSchema,
  PageStateSchema,
  AnnotationListPageSnapshotSchema,
  AnnotationListSnapshotAllPagesSchema,
  PageTextSnapshotSchema,
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
  DocumentHead,
  DocumentManifest,
  ManifestPage,
  WeakAnnotationSessionResponse,
  WeakAnnotationSessionPagesRequest,
} from './wire/schemas';
export { DEFAULT_LAYER_NAME, wirePaths } from './wire/paths';

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
