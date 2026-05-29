/**
 * @embedpdf/engine-services - synchronous, runtime-agnostic PDFium service
 * implementations shared by every Engine v3 host (browser worker, server
 * worker_thread, future direct-thread embedding).
 */

export { MetadataServiceImpl } from './MetadataServiceImpl';

// Session
export { DocumentSession } from './session/DocumentSession';
export { BaseDocumentRegistry } from './session/BaseDocumentRegistry';
export {
  CloseStack,
  openFatMemoryDocument,
  openLayerDocument,
  type AcquiredBaseDocument,
  type LayerSource,
  type OpenedPdfDocument,
  type OpenedPdfDocumentKind,
} from './session/PdfDocumentOpener';
export {
  LocalRevisionAuthority,
  RevisionStore,
  type RevisionAuthority,
} from './session/RevisionStore';
export { PagePtrPool } from './session/PagePtrPool';
export { AnnotationIdentityResolver } from './session/AnnotationIdentityResolver';
export type { ResolvedAnnotation } from './session/AnnotationIdentityResolver';
export type { PageRecord } from './session/PageRecord';

export { ensureInitialized, destroyLibrary } from './runtime-bootstrap';
export { throwIfAborted } from './abort';
export { WorkerHost } from './worker/WorkerHost';

// Metadata readers
export { readMetaText } from './readers/meta-text';
export { readTrapped } from './readers/trapped';
export { readAllCustomMeta } from './readers/custom-meta';
export { formatPdfDate, pdfDateToIso } from './util/pdf-date';

// Annotation readers
export { RawAnnotationReader } from './readers/annotations/RawAnnotationReader';
export { FullAnnotationReader } from './readers/annotations/FullAnnotationReader';

// Text readers
export { PageTextReader } from './readers/text/PageTextReader';
export { PageGeometryReader } from './readers/geometry/PageGeometryReader';
export { PageRasterReader } from './readers/render/PageRasterReader';
export { readAnnotationBase } from './readers/annotations/base';
export { readAnnotationIdentity } from './readers/annotations/identity';
export type { AnnotationIdentity } from './readers/annotations/identity';
export { readAnnotationFromPtr } from './readers/annotations/read-one';
export {
  readAnnotString,
  readAnnotRect,
  readAnnotFlags,
  readAnnotColor,
  readAnnotNumber,
  readQuadPoints,
} from './readers/annotations/util';
export {
  readHighlight,
  readUnderline,
  readSquiggly,
  readStrikeout,
  readTextMarkupExtras,
} from './readers/annotations/text-markup';
export { readUnsupported } from './readers/annotations/unsupported';
export { pickReader } from './readers/annotations/registry';
export type { AnnotationReader } from './readers/annotations/registry';

// Annotation writers
export { applyDraft, applyPatch } from './writers/annotations/registry';
export {
  applyAnnotationBaseDraft,
  applyAnnotationBasePatch,
  writeAnnotationNm,
} from './writers/annotations/base';
export {
  applyTextMarkupDraft,
  applyTextMarkupPatch,
  isTextMarkupSubtype,
} from './writers/annotations/text-markup';

// Mutation
export { ImpactComputer } from './mutation/ImpactComputer';
export type { MutationKind, ImpactInputs } from './mutation/ImpactComputer';
export { DocumentAnnotationMutator } from './mutation/DocumentAnnotationMutator';

// Pages
export { DocumentPagesMutator } from './pages/DocumentPagesMutator';
export { PageLayoutReader } from './pages/PageLayoutReader';

// Util
export { generateUuid } from './util/uuid';
