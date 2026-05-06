/**
 * @embedpdf/engine-core - Engine v3 shared surface.
 *
 * This package contains the interfaces, DTOs, AbortablePromise, error
 * taxonomy, and wire schemas shared by every Engine implementation. It has
 * no runtime dependency on PDFium and no environment-specific code.
 */

export { AbortablePromise } from './promise/AbortablePromise';
export type { AbortableExecutor } from './promise/AbortablePromise';
export { AbortError, isAbortError } from './promise/AbortError';

export type { Engine } from './engine/Engine';
export type { DocumentHandle } from './engine/DocumentHandle';
export type { MetadataService } from './engine/MetadataService';
export type { PageHandle } from './engine/PageHandle';
export type { DocumentAnnotationsService } from './engine/DocumentAnnotationsService';
export type { DocumentPagesService } from './engine/DocumentPagesService';
export type { PageAnnotationsService } from './engine/PageAnnotationsService';

export type { OpenInput, OpenInputBytes, OpenInputPreuploaded, OpenOptions } from './dto/OpenInput';
export type { DocumentMetadata, DocumentMetadataTrapped } from './dto/DocumentMetadata';
export type { PageListSnapshot } from './dto/PageListSnapshot';

export { EngineError, serializeError, deserializeError } from './errors/EngineError';
export type { SerializedEngineError, EngineErrorOptions } from './errors/EngineError';
export { EngineErrorCode } from './errors/EngineErrorCode';

export {
  DocumentMetadataSchema,
  OpenDocumentResponseSchema,
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
export type { OpenDocumentResponse } from './wire/schemas';
export { wirePaths } from './wire/paths';
export { wirePack, EMPTY_TRANSFER } from './wire/WirePack';
export type { WirePack } from './wire/WirePack';

export type {
  WorkerJobId,
  WorkerRequest,
  WorkerResponse,
  WorkerResultPayload,
  WorkerLifecycleMessage,
  OpenWorkerRequest,
  MetadataReadWorkerRequest,
  AnnotationsListRawAllWorkerRequest,
  AnnotationsListRawPageWorkerRequest,
  AnnotationsListFullPageWorkerRequest,
  AnnotationsCreateWorkerRequest,
  AnnotationsUpdateWorkerRequest,
  AnnotationsDeleteWorkerRequest,
  AnnotationsMoveWorkerRequest,
  PagesListWorkerRequest,
  PagesMoveWorkerRequest,
  CloseWorkerRequest,
  AbortWorkerRequest,
  ShutdownWorkerRequest,
} from './wire/worker-protocol';

// Identity
export { isValidPageObjectNumber } from './identity/PageObjectNumber';
export type { PageObjectNumber } from './identity/PageObjectNumber';
export type { AnnotationStableId } from './identity/AnnotationStableId';
export { encodeStableIdKey, decodeStableIdKey } from './identity/AnnotationStableId';
export type { AnnotationRef } from './identity/AnnotationRef';
export type { AnnotationIdentityQuality } from './identity/AnnotationIdentityQuality';

// Revision
export { revisionTokensEqual } from './revision/RevisionToken';
export type { RevisionToken } from './revision/RevisionToken';
export type { PageState } from './revision/PageState';

// Annotation primitives
export type {
  Color,
  Point,
  QuadPoint,
  Rect,
  Size,
  Rotation,
  LineEnding,
  AnnotationFlags,
} from './annotation/primitives';
export { NO_ANNOTATION_FLAGS } from './annotation/primitives';

// Annotation base + subtype catalog
export type { AnnotationBase } from './annotation/base';
export type { AnnotationDraftBase } from './annotation/draft-base';
export type { AnnotationPatchBase } from './annotation/patch-base';
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
  ANNOTATION_SUBTYPES,
  PdfAnnotationSubtypeCode,
  PDF_CODE_TO_SUBTYPE,
  subtypeFromCode,
} from './annotation/subtype';
export type { AnnotationSubtype } from './annotation/subtype';

// Registry + per-kind exports
export type {
  AnnotationKindModule,
  DTOOfKind,
  DraftOfKind,
  PatchOfKind,
} from './annotation/registry';
export {
  ANNOTATION_KINDS,
  KIND_BY_SUBTYPE,
  AnnotationDTOSchema,
  AnnotationDraftSchema,
  AnnotationPatchSchema,
  HighlightKind,
  UnderlineKind,
  SquigglyKind,
  StrikeoutKind,
  UnsupportedKind,
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
export type {
  AnnotationKind,
  AnnotationSubtypeOfKind,
  AnnotationDTO,
  AnnotationDraft,
  AnnotationPatch,
  HighlightAnnotationDTO,
  HighlightDraft,
  HighlightPatch,
  UnderlineAnnotationDTO,
  UnderlineDraft,
  UnderlinePatch,
  SquigglyAnnotationDTO,
  SquigglyDraft,
  SquigglyPatch,
  StrikeoutAnnotationDTO,
  StrikeoutDraft,
  StrikeoutPatch,
  UnsupportedAnnotationDTO,
  UnsupportedDraft,
  UnsupportedPatch,
} from './annotation/kinds';

// Annotation snapshots
export type {
  AnnotationListPageSnapshot,
  AnnotationListSnapshotAllPages,
} from './annotation/AnnotationListSnapshot';

// Mutation results
export type { AnnotationListMutationMeta } from './mutation/AnnotationListMutationMeta';
export type { RefetchReason } from './mutation/RefetchReason';
export type {
  AnnotationCreateResult,
  AnnotationUpdateResult,
  AnnotationDeleteResult,
  AnnotationMoveResult,
} from './mutation/AnnotationMutationResults';
export type { PageMoveInput } from './mutation/PageMoveInput';
export type { PageMoveResult } from './mutation/PageMoveResult';

// Conformance
export { runMetadataConformance } from './conformance/runMetadataConformance';
export type {
  ConformanceTestRunner,
  ConformanceExpect,
  ConformanceFixture,
  ConformanceOptions,
} from './conformance/runMetadataConformance';
export { runAnnotationReadConformance } from './conformance/runAnnotationReadConformance';
export type {
  AnnotationReadConformanceFixture,
  AnnotationConformanceOptions,
} from './conformance/runAnnotationReadConformance';
export { runAnnotationMutationConformance } from './conformance/runAnnotationMutationConformance';
export type {
  AnnotationMutationConformanceFixture,
  AnnotationMutationConformanceOptions,
} from './conformance/runAnnotationMutationConformance';
export { runPageReorderConformance } from './conformance/runPageReorderConformance';
export type {
  PageReorderConformanceFixture,
  PageReorderConformanceOptions,
} from './conformance/runPageReorderConformance';
export {
  diffAnnotationListSnapshot,
  diffAnnotationListSnapshotAll,
} from './conformance/diffAnnotationListSnapshot';
