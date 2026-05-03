/**
 * @embedpdf/engine-services - synchronous, runtime-agnostic PDFium service
 * implementations shared by every Engine v3 host (browser worker, server
 * worker_thread, future direct-thread embedding).
 */

export { MetadataServiceImpl } from './MetadataServiceImpl';
export { DocumentSession } from './session/DocumentSession';
export { ensureInitialized, destroyLibrary } from './runtime-bootstrap';
export { throwIfAborted } from './abort';
export { WorkerHost } from './worker/WorkerHost';

// Readers, exposed for testability and future reuse by other services.
export { readMetaText } from './readers/meta-text';
export { readTrapped } from './readers/trapped';
export { readAllCustomMeta } from './readers/custom-meta';
export { pdfDateToIso } from './readers/pdf-date';
