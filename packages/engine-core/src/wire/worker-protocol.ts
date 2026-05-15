import type {
  AnnotationListPageSnapshot,
  AnnotationListSnapshotAllPages,
} from '../annotation/AnnotationListSnapshot';
import type { AnnotationDraft, AnnotationPatch } from '../annotation/kinds';
import type { DocumentMetadata } from '../dto/DocumentMetadata';
import type { PageListSnapshot } from '../dto/PageListSnapshot';
import type { PageTextSnapshot } from '../dto/PageTextSnapshot';
import type { SerializedEngineError } from '../errors/EngineError';
import type { AnnotationRef } from '../identity/AnnotationRef';
import type { PageObjectNumber } from '../identity/PageObjectNumber';
import type {
  AnnotationCreateResult,
  AnnotationDeleteResult,
  AnnotationMoveResult,
  AnnotationUpdateResult,
} from '../mutation/AnnotationMutationResults';
import type { PageMoveResult } from '../mutation/PageMoveResult';

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

export interface OpenFatMemoryWorkerRequest {
  kind: 'open.fatMem';
  jobId: WorkerJobId;
  docId: string;
  bytes: ArrayBuffer;
  password: string | null;
}

export type LayerOpenSource =
  | { kind: 'fresh' }
  | { kind: 'raw-delta'; bytes: ArrayBuffer }
  | { kind: 'artifact'; bytes: ArrayBuffer };

export interface OpenLayerMemoryBaseWorkerRequest {
  kind: 'open.layerMemBase';
  jobId: WorkerJobId;
  docId: string;
  layerName: string;
  baseKey: string;
  baseBytes: ArrayBuffer;
  layer: LayerOpenSource;
  password: string | null;
}

export interface OpenLayerFileBaseWorkerRequest {
  kind: 'open.layerFileBase';
  jobId: WorkerJobId;
  docId: string;
  /**
   * Omit for the base-view session. Supplying a name opens a separate
   * layer session under the same docId.
   */
  layerName?: string;
  baseKey: string;
  basePath: string;
  layer: LayerOpenSource;
  password: string | null;
}

export type OpenWorkerRequest =
  | OpenFatMemoryWorkerRequest
  | OpenLayerMemoryBaseWorkerRequest
  | OpenLayerFileBaseWorkerRequest;

export interface MetadataReadWorkerRequest {
  kind: 'metadata.read';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
}

export interface AnnotationsListRawAllWorkerRequest {
  kind: 'annotations.listRawAll';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
}

export interface AnnotationsListRawPageWorkerRequest {
  kind: 'annotations.listRawPage';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  pageObjectNumber: PageObjectNumber;
}

export interface AnnotationsListFullPageWorkerRequest {
  kind: 'annotations.listFullPage';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  pageObjectNumber: PageObjectNumber;
}

export interface AnnotationsCreateWorkerRequest {
  kind: 'annotations.create';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  pageObjectNumber: PageObjectNumber;
  draft: AnnotationDraft;
}

export interface AnnotationsUpdateWorkerRequest {
  kind: 'annotations.update';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  ref: AnnotationRef;
  patch: AnnotationPatch;
}

export interface AnnotationsDeleteWorkerRequest {
  kind: 'annotations.delete';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  ref: AnnotationRef;
}

/**
 * Batch annotation reorder. Refs are resolved on the worker BEFORE the
 * move so the impact computation has a single before-state and one
 * revision bump per batch.
 */
export interface AnnotationsMoveWorkerRequest {
  kind: 'annotations.move';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  pageObjectNumber: PageObjectNumber;
  refs: AnnotationRef[];
  toIndex: number;
}

export interface PagesListWorkerRequest {
  kind: 'pages.list';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
}

/**
 * Per-page plain-text extraction. Acquires a pagePtr and runs PDFium's
 * `FPDFText_LoadPage` → `FPDFText_GetText` chain. Identical to
 * `annotations.listFullPage` in shape; both are slow-path per-page
 * reads keyed by indirect object number.
 */
export interface PagesTextWorkerRequest {
  kind: 'pages.text';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  pageObjectNumber: PageObjectNumber;
}

export interface PagesMoveWorkerRequest {
  kind: 'pages.move';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  pageObjectNumbers: PageObjectNumber[];
  destIndex: number;
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
  | AnnotationsCreateWorkerRequest
  | AnnotationsUpdateWorkerRequest
  | AnnotationsDeleteWorkerRequest
  | AnnotationsMoveWorkerRequest
  | PagesListWorkerRequest
  | PagesMoveWorkerRequest
  | PagesTextWorkerRequest
  | CloseWorkerRequest
  | AbortWorkerRequest
  | ShutdownWorkerRequest;

export type WorkerResultPayload =
  | { tag: 'open'; docId: string }
  | { tag: 'metadata.read'; metadata: DocumentMetadata }
  | { tag: 'annotations.listRawAll'; snapshot: AnnotationListSnapshotAllPages }
  | { tag: 'annotations.listRawPage'; snapshot: AnnotationListPageSnapshot }
  | { tag: 'annotations.listFullPage'; snapshot: AnnotationListPageSnapshot }
  | { tag: 'annotations.create'; result: AnnotationCreateResult }
  | { tag: 'annotations.update'; result: AnnotationUpdateResult }
  | { tag: 'annotations.delete'; result: AnnotationDeleteResult }
  | { tag: 'annotations.move'; result: AnnotationMoveResult }
  | { tag: 'pages.list'; snapshot: PageListSnapshot }
  | { tag: 'pages.move'; result: PageMoveResult }
  | { tag: 'pages.text'; snapshot: PageTextSnapshot }
  | { tag: 'close' }
  | { tag: 'shutdown' };

export type WorkerResponse =
  | { kind: 'resolve'; jobId: WorkerJobId; result: WorkerResultPayload }
  | { kind: 'reject'; jobId: WorkerJobId; error: SerializedEngineError };

export type WorkerLifecycleMessage = { kind: 'ready' } | { kind: 'init-error'; error: string };
