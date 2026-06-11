/**
 * Zod-free engine runtime entrypoint.
 *
 * Local/browser engines and service implementations import this subpath for
 * engine handles, AbortablePromise, worker protocol, transport helpers, and
 * the shared zod-free domain surface.
 */

export * from './shared';

export { AbortablePromise } from './promise/AbortablePromise';
export type { AbortableExecutor } from './promise/AbortablePromise';
export { AbortError, isAbortError } from './promise/AbortError';

export type { Engine } from './engine/Engine';
export type { DocumentHandle } from './engine/DocumentHandle';
export type {
  DocumentEvent,
  DocumentEventInit,
  DocumentEventType,
  EventOrigin,
} from './events/DocumentEvent';
export type { DocumentEventStream } from './events/DocumentEventStream';
export {
  advisoryFromPdfBits,
  permissionInfoFromProbe,
  permissionInfoWithAdvisory,
  securityStateFromHead,
  securityStateFromProbe,
} from './engine/document-security-state';
export type {
  CdnAccessInfo,
  CdnAdapter,
  DocumentAccessInfo,
  DocumentAccessReason,
  DocumentEncryptionState,
  DocumentIdentity,
  DocumentOpenMode,
  DocumentSecurityService,
  DocumentSecurityState,
  DocumentUnlockInput,
  DocumentUnlockResult,
  PdfPermissionAdvisory,
  PdfPermissionInfo,
} from './engine/DocumentSecurityService';
export { passwordPromptFromState } from './engine/passwordPrompt';
export type { PasswordPrompt } from './engine/passwordPrompt';
export type { DocumentCapabilities } from './engine/DocumentHandle';
export type { MetadataService } from './engine/MetadataService';
export type { PageHandle } from './engine/PageHandle';
export type { DocumentAnnotationsService } from './engine/DocumentAnnotationsService';
export type { WeakAnnotationEditSession } from './engine/DocumentAnnotationsService';
export type { DocumentPagesService } from './engine/DocumentPagesService';
export type { PageAnnotationsService } from './engine/PageAnnotationsService';
export type { PageTextService } from './engine/PageTextService';
export type { PageGeometryService } from './engine/PageGeometryService';
export type { PageRenderService } from './engine/PageRenderService';

export { wirePack, EMPTY_TRANSFER } from './wire/WirePack';
export type { WirePack } from './wire/WirePack';

export type {
  WorkerJobId,
  WorkerRequest,
  WorkerResponse,
  WorkerResultPayload,
  WorkerLifecycleMessage,
  OpenWorkerRequest,
  OpenFatMemoryWorkerRequest,
  OpenLayerMemoryBaseWorkerRequest,
  OpenLayerFileBaseWorkerRequest,
  LayerOpenSource,
  MetadataReadWorkerRequest,
  MetadataUpdateWorkerRequest,
  AnnotationsListRawAllWorkerRequest,
  AnnotationsListRawPageWorkerRequest,
  AnnotationsListFullPageWorkerRequest,
  AnnotationsCreateWorkerRequest,
  AnnotationsUpdateWorkerRequest,
  AnnotationsDeleteWorkerRequest,
  AnnotationsMoveWorkerRequest,
  DocumentSaveBufferWorkerRequest,
  DocumentSaveFileWorkerRequest,
  DocumentCheckPasswordPermissionsWorkerRequest,
  DocumentProbeSecurityFileWorkerRequest,
  DocumentSecurityProbeInfo,
  PagesListWorkerRequest,
  PagesMoveWorkerRequest,
  PagesRotateWorkerRequest,
  PagesDeleteWorkerRequest,
  PagesTextWorkerRequest,
  PagesGeometryWorkerRequest,
  PagesRenderWorkerRequest,
  CloseWorkerRequest,
  AbortWorkerRequest,
  ShutdownWorkerRequest,
  LayerArtifactWorkerPayload,
  LayerArtifactFileWorkerPayload,
} from './wire/worker-protocol';
