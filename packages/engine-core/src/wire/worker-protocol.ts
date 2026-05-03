import type {
  AnnotationListPageSnapshot,
  AnnotationListSnapshotAllPages,
} from '../annotation/AnnotationListSnapshot';
import type { DocumentMetadata } from '../dto/DocumentMetadata';
import type { SerializedEngineError } from '../errors/EngineError';
import type { PageObjectNumber } from '../identity/PageObjectNumber';

/**
 * Wire protocol used between an Engine-side queue and any Worker host
 * (browser Web Worker, Node worker_thread, inline). Cloud HTTP traffic
 * uses a different envelope; this is purely the worker boundary.
 *
 * Identical between @embedpdf/engine-local and @embedpdf/server because
 * the WorkerHost dispatch logic is the same on both sides — only the
 * underlying PdfRuntimeModule (WASM vs native) differs.
 */
export type WorkerJobId = number;

export interface OpenWorkerRequest {
  kind: 'open';
  jobId: WorkerJobId;
  docId: string;
  bytes: ArrayBuffer;
  password: string | null;
}

export interface MetadataReadWorkerRequest {
  kind: 'metadata.read';
  jobId: WorkerJobId;
  docId: string;
}

export interface AnnotationsListRawAllWorkerRequest {
  kind: 'annotations.listRawAll';
  jobId: WorkerJobId;
  docId: string;
}

export interface AnnotationsListRawPageWorkerRequest {
  kind: 'annotations.listRawPage';
  jobId: WorkerJobId;
  docId: string;
  pageObjectNumber: PageObjectNumber;
}

export interface AnnotationsListFullPageWorkerRequest {
  kind: 'annotations.listFullPage';
  jobId: WorkerJobId;
  docId: string;
  pageObjectNumber: PageObjectNumber;
}

export interface CloseWorkerRequest {
  kind: 'close';
  jobId: WorkerJobId;
  docId: string;
}

export interface AbortWorkerRequest {
  kind: 'abort';
  jobId: WorkerJobId;
}

export interface ShutdownWorkerRequest {
  kind: 'shutdown';
  jobId: WorkerJobId;
}

export type WorkerRequest =
  | OpenWorkerRequest
  | MetadataReadWorkerRequest
  | AnnotationsListRawAllWorkerRequest
  | AnnotationsListRawPageWorkerRequest
  | AnnotationsListFullPageWorkerRequest
  | CloseWorkerRequest
  | AbortWorkerRequest
  | ShutdownWorkerRequest;

export type WorkerResultPayload =
  | { tag: 'open'; docId: string }
  | { tag: 'metadata.read'; metadata: DocumentMetadata }
  | { tag: 'annotations.listRawAll'; snapshot: AnnotationListSnapshotAllPages }
  | { tag: 'annotations.listRawPage'; snapshot: AnnotationListPageSnapshot }
  | { tag: 'annotations.listFullPage'; snapshot: AnnotationListPageSnapshot }
  | { tag: 'close' }
  | { tag: 'shutdown' };

export type WorkerResponse =
  | { kind: 'resolve'; jobId: WorkerJobId; result: WorkerResultPayload }
  | { kind: 'reject'; jobId: WorkerJobId; error: SerializedEngineError };

export type WorkerLifecycleMessage = { kind: 'ready' } | { kind: 'init-error'; error: string };
