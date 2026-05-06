import { AbortablePromise } from '../promise/AbortablePromise';
import type { PageObjectNumber } from '../identity/PageObjectNumber';
import type { DocumentAnnotationsService } from './DocumentAnnotationsService';
import type { DocumentPagesService } from './DocumentPagesService';
import type { MetadataService } from './MetadataService';
import type { PageHandle } from './PageHandle';

export interface DocumentHandle {
  readonly id: string;
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
   * Returns a handle scoped to a page by PDF indirect object number.
   * Throws `EngineError(NotFound)` if the document has no such page.
   * Synchronous because page records are cached on `DocumentSession`.
   *
   * Note: when mutations land, `DocumentHandle` will also expose
   * `sessionId` so clients can detect engine restarts. The revision
   * tokens already carry it internally; we will plumb it through then.
   */
  page(pageObjectNumber: PageObjectNumber): PageHandle;
  close(): AbortablePromise<void>;
}
