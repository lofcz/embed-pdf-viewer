import { AbortablePromise } from '../promise/AbortablePromise';
import type { PageObjectNumber } from '../identity/PageObjectNumber';
import type { PdfSaveMode } from '../dto/PdfSaveMode';
import type { DocumentEventStream } from '../events/DocumentEventStream';
import type { DocumentAnnotationsService } from './DocumentAnnotationsService';
import type { DocumentPagesService } from './DocumentPagesService';
import type { DocumentSecurityService } from './DocumentSecurityService';
import type { MetadataService } from './MetadataService';
import type { PageHandle } from './PageHandle';

export interface DocumentCapabilities {
  readonly weakAnnotationEditSessions: 'not-needed' | 'required';
  readonly pageEditSessions: 'unsupported' | 'supported';
}

export interface DocumentHandle {
  readonly id: string;
  readonly capabilities: DocumentCapabilities;
  readonly security: DocumentSecurityService;
  readonly metadata: MetadataService;
  readonly annotations: DocumentAnnotationsService;
  /**
   * Document-scoped page service. Use for cross-page operations:
   *   - `pages.list()` for the current display order.
   *   - `pages.move(pons, destIndex)` for reorder.
   *
   * Per-page reads/writes still live on `page(pon).annotations`.
   */
  readonly pages: DocumentPagesService;
  /**
   * The document's event stream — every confirmed mutation, exactly once,
   * identical shape on local and cloud engines (see `DocumentEvent`). The
   * engine-instance identity lives on each event's `origin.sessionId`.
   */
  readonly events: DocumentEventStream;
  /**
   * Returns a handle scoped to a page by PDF indirect object number.
   * Throws `EngineError(NotFound)` if the document has no such page.
   * Synchronous because page records are cached on `DocumentSession`.
   */
  page(pageObjectNumber: PageObjectNumber): PageHandle;
  download(opts?: { mode?: PdfSaveMode }): AbortablePromise<Uint8Array>;
  close(): AbortablePromise<void>;
}
