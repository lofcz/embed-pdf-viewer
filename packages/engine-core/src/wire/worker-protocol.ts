import type {
  AnnotationListPageSnapshot,
  AnnotationListSnapshotAllPages,
} from '../annotation/AnnotationListSnapshot';
import type { WireAnnotationDraft, WireAnnotationPatch } from '../annotation/kinds';
import type { AnnotationActor } from '../auth/scope';
import type { WireResourceMap } from '../resource/BinarySource';
import type {
  AnnotationAppearanceRenderOptions,
  AnnotationAppearancesResult,
} from '../dto/AnnotationRender';
import type { DocumentMetadata } from '../dto/DocumentMetadata';
import type { MetadataPatch } from '../dto/MetadataPatch';
import type { PageGeometrySnapshot } from '../dto/PageGeometrySnapshot';
import type { PageRotation } from '../dto/PageLayout';
import type { PageListSnapshot } from '../dto/PageListSnapshot';
import type { PageRaster, PageRenderOptions } from '../dto/PageRender';
import type { PageTextSnapshot } from '../dto/PageTextSnapshot';
import type { PdfSaveMode } from '../dto/PdfSaveMode';
import type { SerializedEngineError } from '../errors/EngineError';
import type { AnnotationRef } from '../identity/AnnotationRef';
import type { PageObjectNumber } from '../identity/PageObjectNumber';
import type {
  AnnotationCreateResult,
  AnnotationDeleteResult,
  AnnotationMoveResult,
  AnnotationUpdateResult,
} from '../mutation/AnnotationMutationResults';
import type { MetadataUpdateResult } from '../mutation/MetadataUpdateResult';
import type { PageDeleteResult } from '../mutation/PageDeleteResult';
import type { PageMoveResult } from '../mutation/PageMoveResult';
import type { PageRotateResult } from '../mutation/PageRotateResult';

/**
 * Wire protocol used between an Engine-side queue and any Worker host
 * (browser Web Worker, Node worker_thread, inline). Cloud HTTP traffic
 * uses a different envelope; this is purely the worker boundary.
 *
 * Identical between @embedpdf/engine and @cloudpdf/server because
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
  | { kind: 'artifact'; bytes: ArrayBuffer }
  | { kind: 'artifact-file'; path: string };

export interface OpenLayerMemoryBaseWorkerRequest {
  kind: 'open.layerMemBase';
  jobId: WorkerJobId;
  docId: string;
  /**
   * Omit for a handle whose docId already uniquely identifies the layer
   * session. Cloud layer sessions supply a real layer name when multiple
   * layer views must live under one docId.
   */
  layerName?: string;
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

export interface MetadataUpdateWorkerRequest {
  kind: 'metadata.update';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  patch: MetadataPatch;
  artifactPath?: string;
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

/**
 * Batch-render every annotation appearance stream on a page. Acquires a
 * `pagePtr`, iterates `/Annots`, and renders each annotation's `/AP` via
 * `EPDF_RenderAnnotBitmap` into its own raster. Read-only; gated on the
 * render capability like `pages.render`.
 */
export interface AnnotationsRenderAppearancesWorkerRequest {
  kind: 'annotations.renderAppearances';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  pageObjectNumber: PageObjectNumber;
  options?: AnnotationAppearanceRenderOptions;
}

export interface AnnotationsCreateWorkerRequest {
  kind: 'annotations.create';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  pageObjectNumber: PageObjectNumber;
  /** WIRE form — binary fields hold `{ resource }` refs into {@link resources}. */
  draft: WireAnnotationDraft;
  /**
   * Binary payloads referenced by the draft, keyed by resource key. The
   * producer puts each `bytes` buffer on the wirePack transfer list
   * (zero-copy, same convention as `PageRaster`).
   */
  resources?: WireResourceMap;
  artifactPath?: string;
  /**
   * Identity to stamp on the newly created annotation:
   *   - `displayName` → /T (PDF author field)
   *   - `userId` / `groupId` → /EMBD_Metadata/{UserID,GroupID,CreatedBy,UpdatedBy}
   * Optional — when absent (engine-local with no identity, anonymous tests),
   * the worker still stamps the standard /M (modification date) but skips
   * EMBD_Metadata.
   */
  actor?: AnnotationActor;
}

export interface AnnotationsUpdateWorkerRequest {
  kind: 'annotations.update';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  ref: AnnotationRef;
  /** WIRE form — see {@link AnnotationsCreateWorkerRequest.draft}. */
  patch: WireAnnotationPatch;
  /** Binary payloads referenced by the patch — see the create request. */
  resources?: WireResourceMap;
  artifactPath?: string;
  /**
   * Identity of the editor. Drives /EMBD_Metadata/UpdatedBy refresh on
   * update; preserves UserID/GroupID/CreatedBy. When absent, only /M
   * is refreshed.
   */
  actor?: AnnotationActor;
}

export interface AnnotationsDeleteWorkerRequest {
  kind: 'annotations.delete';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  ref: AnnotationRef;
  artifactPath?: string;
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
  artifactPath?: string;
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

export interface PagesGeometryWorkerRequest {
  kind: 'pages.geometry';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  pageObjectNumber: PageObjectNumber;
}

export interface PagesRenderWorkerRequest {
  kind: 'pages.render';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  pageObjectNumber: PageObjectNumber;
  options?: PageRenderOptions;
}

export interface PagesMoveWorkerRequest {
  kind: 'pages.move';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  pageObjectNumbers: PageObjectNumber[];
  destIndex: number;
  artifactPath?: string;
}

export interface PagesRotateWorkerRequest {
  kind: 'pages.rotate';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  pageObjectNumbers: PageObjectNumber[];
  /** Absolute rotation in degrees clockwise — see `PageRotateInput`. */
  rotation: PageRotation;
  artifactPath?: string;
}

export interface PagesDeleteWorkerRequest {
  kind: 'pages.delete';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  pageObjectNumbers: PageObjectNumber[];
  artifactPath?: string;
}

export interface DocumentSaveBufferWorkerRequest {
  kind: 'document.saveBuffer';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  mode: PdfSaveMode;
}

export interface DocumentSaveFileWorkerRequest {
  kind: 'document.saveFile';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  mode: PdfSaveMode;
  path: string;
}

/** Export JUST the layer artifact (the overlay diff) to a transferable buffer.
 *  Layer sessions only; the host rejects a base-only session. */
export interface DocumentSaveLayerBufferWorkerRequest {
  kind: 'document.saveLayerBuffer';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
}

export interface DocumentSecurityProbeInfo {
  encryptionState: 'unknown' | 'none' | 'encrypted' | 'unsupported';
  encryptionRequiresPassword: boolean | null;
  securityHandlerRevision: number | null;
  pdfPermissionsBits: number | null;
  pdfPermissionsAllAllowed: boolean | null;
  pdfOpenedAs: 'none' | 'user' | 'owner' | null;
  securityProbedAt: number | null;
}

export interface DocumentProbeSecurityFileWorkerRequest {
  kind: 'document.probeSecurityFile';
  jobId: WorkerJobId;
  path: string;
  password: string | null;
}

export interface DocumentCheckPasswordPermissionsWorkerRequest {
  kind: 'document.checkPasswordPermissions';
  jobId: WorkerJobId;
  docId: string;
  layerName?: string;
  password: string;
  mode?: 'any' | 'owner';
}

/**
 * Register a runtime font on the host's PDFium thread. Carries the font bytes
 * as a transferable `ArrayBuffer` (declared in the producer's transfer
 * manifest, like `open.fatMem`). Runtime-global: not tied to any docId. The
 * host keeps the volatile native `FontId` keyed by `fontKey`; the wire only
 * ever references the stable `fontKey`.
 */
export interface FontsRegisterWorkerRequest {
  kind: 'fonts.register';
  jobId: WorkerJobId;
  fontKey: string;
  /** `""` → infer the base font name from the file. */
  familyName: string;
  /** `0` → infer the weight from the file. */
  weight: number;
  /** `-1` → infer / `0` non-italic / `1` italic. */
  italic: number;
  data: ArrayBuffer;
}

export interface FontsAddFallbackWorkerRequest {
  kind: 'fonts.addFallback';
  jobId: WorkerJobId;
  fontKey: string;
}

export interface FontsClearFallbacksWorkerRequest {
  kind: 'fonts.clearFallbacks';
  jobId: WorkerJobId;
}

export interface FontsClearWorkerRequest {
  kind: 'fonts.clear';
  jobId: WorkerJobId;
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

export interface LayerArtifactWorkerPayload {
  bytes: ArrayBuffer;
  size: number;
}

export interface LayerArtifactFileWorkerPayload {
  path: string;
}

export type WorkerRequest =
  | OpenWorkerRequest
  | MetadataReadWorkerRequest
  | MetadataUpdateWorkerRequest
  | AnnotationsListRawAllWorkerRequest
  | AnnotationsListRawPageWorkerRequest
  | AnnotationsListFullPageWorkerRequest
  | AnnotationsRenderAppearancesWorkerRequest
  | AnnotationsCreateWorkerRequest
  | AnnotationsUpdateWorkerRequest
  | AnnotationsDeleteWorkerRequest
  | AnnotationsMoveWorkerRequest
  | PagesListWorkerRequest
  | PagesMoveWorkerRequest
  | PagesRotateWorkerRequest
  | PagesDeleteWorkerRequest
  | PagesTextWorkerRequest
  | PagesGeometryWorkerRequest
  | PagesRenderWorkerRequest
  | DocumentSaveBufferWorkerRequest
  | DocumentSaveFileWorkerRequest
  | DocumentSaveLayerBufferWorkerRequest
  | DocumentProbeSecurityFileWorkerRequest
  | DocumentCheckPasswordPermissionsWorkerRequest
  | FontsRegisterWorkerRequest
  | FontsAddFallbackWorkerRequest
  | FontsClearFallbacksWorkerRequest
  | FontsClearWorkerRequest
  | CloseWorkerRequest
  | AbortWorkerRequest
  | ShutdownWorkerRequest;

export type WorkerResultPayload =
  | { tag: 'open'; docId: string; security: DocumentSecurityProbeInfo }
  | { tag: 'metadata.read'; metadata: DocumentMetadata }
  | {
      tag: 'metadata.update';
      result: MetadataUpdateResult;
      artifact?: LayerArtifactWorkerPayload;
      artifactFile?: LayerArtifactFileWorkerPayload;
    }
  | { tag: 'annotations.listRawAll'; snapshot: AnnotationListSnapshotAllPages }
  | { tag: 'annotations.listRawPage'; snapshot: AnnotationListPageSnapshot }
  | { tag: 'annotations.listFullPage'; snapshot: AnnotationListPageSnapshot }
  | { tag: 'annotations.renderAppearances'; result: AnnotationAppearancesResult }
  | {
      tag: 'annotations.create';
      result: AnnotationCreateResult;
      artifact?: LayerArtifactWorkerPayload;
      artifactFile?: LayerArtifactFileWorkerPayload;
    }
  | {
      tag: 'annotations.update';
      result: AnnotationUpdateResult;
      artifact?: LayerArtifactWorkerPayload;
      artifactFile?: LayerArtifactFileWorkerPayload;
    }
  | {
      tag: 'annotations.delete';
      result: AnnotationDeleteResult;
      artifact?: LayerArtifactWorkerPayload;
      artifactFile?: LayerArtifactFileWorkerPayload;
    }
  | {
      tag: 'annotations.move';
      result: AnnotationMoveResult;
      artifact?: LayerArtifactWorkerPayload;
      artifactFile?: LayerArtifactFileWorkerPayload;
    }
  | { tag: 'pages.list'; snapshot: PageListSnapshot }
  | {
      tag: 'pages.move';
      result: PageMoveResult;
      artifact?: LayerArtifactWorkerPayload;
      artifactFile?: LayerArtifactFileWorkerPayload;
    }
  | {
      tag: 'pages.rotate';
      result: PageRotateResult;
      artifact?: LayerArtifactWorkerPayload;
      artifactFile?: LayerArtifactFileWorkerPayload;
    }
  | {
      tag: 'pages.delete';
      result: PageDeleteResult;
      artifact?: LayerArtifactWorkerPayload;
      artifactFile?: LayerArtifactFileWorkerPayload;
    }
  | { tag: 'pages.text'; snapshot: PageTextSnapshot }
  | { tag: 'pages.geometry'; snapshot: PageGeometrySnapshot }
  | { tag: 'pages.render'; raster: PageRaster }
  | { tag: 'document.saveBuffer'; bytes: ArrayBuffer; size: number }
  | { tag: 'document.saveLayerBuffer'; bytes: ArrayBuffer; size: number }
  | { tag: 'document.saveFile'; path: string }
  | { tag: 'document.probeSecurityFile'; security: DocumentSecurityProbeInfo }
  | { tag: 'document.checkPasswordPermissions'; security: DocumentSecurityProbeInfo }
  | { tag: 'fonts.register'; fontKey: string }
  | { tag: 'fonts.addFallback' }
  | { tag: 'fonts.clearFallbacks' }
  | { tag: 'fonts.clear' }
  | { tag: 'close' }
  | { tag: 'shutdown' };

export type WorkerResponse =
  | { kind: 'resolve'; jobId: WorkerJobId; result: WorkerResultPayload }
  | { kind: 'reject'; jobId: WorkerJobId; error: SerializedEngineError };

export type WorkerLifecycleMessage = { kind: 'ready' } | { kind: 'init-error'; error: string };
