/**
 * Zod-free shared domain surface.
 *
 * This entry is the overlap between runtime implementations and wire schemas:
 * stable DTO types, identity helpers, revision helpers, mutation result types,
 * and the shared engine error taxonomy. It deliberately excludes engine
 * handles, AbortablePromise, worker protocol, wire schemas, and conformance.
 */

export type { OpenInput, OpenInputBytes, OpenInputPreuploaded, OpenOptions } from './dto/OpenInput';
export type { DocumentMetadata, DocumentMetadataTrapped } from './dto/DocumentMetadata';
export type { PageListSnapshot } from './dto/PageListSnapshot';

export { EngineError, serializeError, deserializeError } from './errors/EngineError';
export type { SerializedEngineError, EngineErrorOptions } from './errors/EngineError';
export { EngineErrorCode } from './errors/EngineErrorCode';

export { isValidPageObjectNumber } from './identity/PageObjectNumber';
export type { PageObjectNumber } from './identity/PageObjectNumber';
export type { AnnotationStableId } from './identity/AnnotationStableId';
export { encodeStableIdKey, decodeStableIdKey } from './identity/AnnotationStableId';
export type { AnnotationRef } from './identity/AnnotationRef';
export type { AnnotationIdentityQuality } from './identity/AnnotationIdentityQuality';

export { revisionTokensEqual } from './revision/RevisionToken';
export type { RevisionToken } from './revision/RevisionToken';
export type { PageState } from './revision/PageState';

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

export type { AnnotationBase } from './annotation/base';
export type { AnnotationDraftBase } from './annotation/draft-base';
export type { AnnotationPatchBase } from './annotation/patch-base';
export {
  ANNOTATION_SUBTYPES,
  PdfAnnotationSubtypeCode,
  PDF_CODE_TO_SUBTYPE,
  PDF_SUBTYPE_TO_CODE,
  subtypeFromCode,
} from './annotation/subtype';
export type { AnnotationSubtype } from './annotation/subtype';

export type {
  AnnotationKindModule,
  DTOOfKind,
  DraftOfKind,
  PatchOfKind,
} from './annotation/registry';
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

export type {
  AnnotationListPageSnapshot,
  AnnotationListSnapshotAllPages,
} from './annotation/AnnotationListSnapshot';

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
