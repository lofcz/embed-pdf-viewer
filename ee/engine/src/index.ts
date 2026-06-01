/**
 * @cloudpdf/engine - Engine v3 cloud client.
 *
 * Implements the same {@link Engine} interface as `@embedpdf/engine-local` but
 * routes calls to a remote `@cloudpdf/server` over HTTP. Same observable
 * contract: {@link AbortablePromise}-based, EngineError-coded, parity-tested
 * with `runMetadataConformance`.
 */
export { CloudEngine } from './CloudEngine';
export type { CloudEngineOptions } from './CloudEngine';
export { CloudDocumentHandle } from './document/CloudDocumentHandle';
export { CloudMetadataService } from './document/CloudMetadataService';
export { CloudDocumentAnnotationsService } from './document/CloudDocumentAnnotationsService';
export { CloudDocumentPagesService } from './document/CloudDocumentPagesService';
export { CloudPageHandle } from './document/CloudPageHandle';
export { CloudPageAnnotationsService } from './document/CloudPageAnnotationsService';
export { CloudPageGeometryService } from './document/CloudPageGeometryService';
export { CloudPageRenderService } from './document/CloudPageRenderService';
export { HttpClient } from './transport/HttpClient';
export type { HttpClientOptions } from './transport/HttpClient';
export { decodeUnverifiedClaims } from './transport/decodeUnverifiedClaims';
export type { UnverifiedClaims } from './transport/decodeUnverifiedClaims';

import { CloudEngine, type CloudEngineOptions } from './CloudEngine';

export function createCloudEngine(opts: CloudEngineOptions): CloudEngine {
  return CloudEngine.fromOptions(opts);
}

// Re-export the shared engine runtime surface so consumers import every
// public type and primitive from a single `@cloudpdf/engine` entrypoint
// instead of reaching into the transitive `@embedpdf/engine-core` dep.
export {
  AbortablePromise,
  AbortError,
  EngineError,
  EngineErrorCode,
} from '@embedpdf/engine-core/runtime';
export type {
  Engine,
  DocumentHandle,
  DocumentCapabilities,
  PageHandle,
  OpenInput,
  OpenOptions,
  TokenSource,
  MetadataService,
  DocumentPagesService,
  DocumentAnnotationsService,
  PageAnnotationsService,
  PageTextService,
  PageGeometryService,
  PageRenderService,
  DocumentSecurityService,
  DocumentSecurityState,
  DocumentUnlockInput,
  DocumentUnlockResult,
  DocumentAccessInfo,
  DocumentIdentity,
  PdfSaveMode,
} from '@embedpdf/engine-core/runtime';
