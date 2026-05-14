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
export type { MetadataService } from './engine/MetadataService';
export type { PageHandle } from './engine/PageHandle';
export type { DocumentAnnotationsService } from './engine/DocumentAnnotationsService';
export type { DocumentPagesService } from './engine/DocumentPagesService';
export type { PageAnnotationsService } from './engine/PageAnnotationsService';

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
