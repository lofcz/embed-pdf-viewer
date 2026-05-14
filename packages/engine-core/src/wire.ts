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
  EngineErrorPayloadSchema,
  PageStateSchema,
  AnnotationListPageSnapshotSchema,
  AnnotationListSnapshotAllPagesSchema,
  RefetchReasonSchema,
  AnnotationListMutationMetaSchema,
  AnnotationCreateResultSchema,
  AnnotationUpdateResultSchema,
  AnnotationDeleteResultSchema,
  AnnotationMoveResultSchema,
  PageListSnapshotSchema,
  PageMoveInputSchema,
  PageMoveResultSchema,
} from './wire/schemas';
export type { OpenDocumentResponse, DocumentHead } from './wire/schemas';
export { wirePaths } from './wire/paths';

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
