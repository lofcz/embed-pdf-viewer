/**
 * Zod-free shared domain surface.
 *
 * This entry is the overlap between runtime implementations and wire schemas:
 * stable DTO types, identity helpers, revision helpers, mutation result types,
 * and the shared engine error taxonomy. It deliberately excludes engine
 * handles, AbortablePromise, worker protocol, wire schemas, and conformance.
 */

export type {
  OpenInput,
  OpenInputBytes,
  OpenInputLayerBytes,
  OpenInputLayerSource,
  OpenInputById,
  OpenInputToken,
  OpenOptions,
  TokenSource,
} from './dto/OpenInput';
export type { DocumentMetadata, DocumentMetadataTrapped } from './dto/DocumentMetadata';
export type { PageListSnapshot } from './dto/PageListSnapshot';
export type { PageLayout, PageBoxes, PdfRect } from './dto/PageLayout';
export type { PageTextSnapshot } from './dto/PageTextSnapshot';
export type {
  PageGeometryGlyph,
  PageGeometryRun,
  PageGeometrySnapshot,
} from './dto/PageGeometrySnapshot';
export type {
  PageImageHandle,
  PageImageBlobSource,
  PageImageOptions,
  PageImageObjectUrl,
  PageImageResult,
  PageImageSource,
  PageNetworkRenderFormat,
  PageRaster,
  PageRenderBackground,
  PageRenderEncodedFormat,
  PageRenderFormat,
  PageRenderOptions,
  PageRenderQuery,
  PageRenderTarget,
  PageRenderViewport,
} from './dto/PageRender';
export { createPageImageHandle } from './dto/PageRender';
export type { CachePins } from './dto/CachePins';
export { DEFAULT_PDF_SAVE_MODE } from './dto/PdfSaveMode';
export type { PdfSaveMode } from './dto/PdfSaveMode';

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
export {
  UNKNOWN_WEAK_ANNOTATION_STATE,
  knownWeakAnnotationState,
} from './revision/WeakAnnotationState';
export type { WeakAnnotationState } from './revision/WeakAnnotationState';

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

export type { DocumentManifest, ManifestPage } from './dto/DocumentManifest';
export type { CacheDelta, MutationMeta } from './mutation/MutationMeta';
export type { AnnotationListMutationMeta } from './mutation/AnnotationListMutationMeta';
export {
  changesAnnotationList,
  shiftsExistingAnnotationIndices,
  invalidatesWeakIndexRefs,
} from './mutation/AnnotationMutationImpactPolicy';
export type { AnnotationMutationKind } from './mutation/AnnotationMutationImpactPolicy';
export type { RefetchReason } from './mutation/RefetchReason';
export type {
  AnnotationCreateResult,
  AnnotationUpdateResult,
  AnnotationDeleteResult,
  AnnotationMoveResult,
} from './mutation/AnnotationMutationResults';
export type { PageMoveInput } from './mutation/PageMoveInput';
export type { PageMoveResult, PageMoveCache } from './mutation/PageMoveResult';

export type {
  AnnotationActor,
  CollabAction,
  CollabEntity,
  CollabFilter,
  DocCapability,
  IdentityClaims,
  ParsedCapability,
  ParsedCollab,
  ParsedScope,
  ParsedVirtual,
  ParsedWildcard,
  PdfBits,
} from './auth/scope';
export { PDF_BITS, decodePdfBits } from './auth/scope';
export { parseScope, validateScopeArray } from './auth/scope';
export { InvalidScope, MissingIdentity, PermissionDenied } from './auth/scope';
export type { CollabTarget } from './auth/scope';
export {
  checkAnyCapability,
  checkCapability,
  checkCollab,
  checkSetGroup,
  expandedCapabilities,
  expandRawScope,
  filterMatches,
} from './auth/scope';
export { caps, collab, materializePdfPermissions, pdfPermissions } from './auth/scope';

// NOTE: CDN-shaped surface (DOC_RESOURCES, cdnCoverageForScope, applyCdnAccess,
// CdnCoverageEntry, etc.) is deliberately NOT re-exported here. It lives under
// `@embedpdf/engine-core/wire` only, because it is HTTP-wire territory: server
// route guards and the cloud SDK consume it, and engine-local must not pull it
// into its bundle. See ENGINE_CORE_BOUNDARIES.md (or wire/cdn/README.md) for
// the rationale and where to import from.
