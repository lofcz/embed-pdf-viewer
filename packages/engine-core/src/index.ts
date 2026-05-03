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

export type { OpenInput, OpenInputBytes, OpenInputPreuploaded, OpenOptions } from './dto/OpenInput';
export type { DocumentMetadata, DocumentMetadataTrapped } from './dto/DocumentMetadata';

export { EngineError, serializeError, deserializeError } from './errors/EngineError';
export type { SerializedEngineError, EngineErrorOptions } from './errors/EngineError';
export { EngineErrorCode } from './errors/EngineErrorCode';

export {
  DocumentMetadataSchema,
  OpenDocumentResponseSchema,
  EngineErrorPayloadSchema,
} from './wire/schemas';
export type { OpenDocumentResponse } from './wire/schemas';
export { wirePaths } from './wire/paths';

export type {
  WorkerJobId,
  WorkerRequest,
  WorkerResponse,
  WorkerResultPayload,
  WorkerLifecycleMessage,
  OpenWorkerRequest,
  MetadataReadWorkerRequest,
  CloseWorkerRequest,
  AbortWorkerRequest,
  ShutdownWorkerRequest,
} from './wire/worker-protocol';

export { runMetadataConformance } from './conformance/runMetadataConformance';
export type {
  ConformanceTestRunner,
  ConformanceExpect,
  ConformanceFixture,
  ConformanceOptions,
} from './conformance/runMetadataConformance';
