/**
 * @embedpdf/engine-cloud - Engine v3 cloud client.
 *
 * Implements the same {@link Engine} interface as `@embedpdf/engine-local` but
 * routes calls to a remote `@embedpdf/server` over HTTP. Same observable
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
export { HttpClient } from './transport/HttpClient';
export type { HttpClientOptions } from './transport/HttpClient';
export { decodeUnverifiedClaims } from './transport/decodeUnverifiedClaims';
export type { UnverifiedClaims } from './transport/decodeUnverifiedClaims';

import { CloudEngine, type CloudEngineOptions } from './CloudEngine';

export function createCloudEngine(opts: CloudEngineOptions): CloudEngine {
  return CloudEngine.fromOptions(opts);
}
