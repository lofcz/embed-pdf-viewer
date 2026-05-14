import type { PageObjectNumber } from '../identity/PageObjectNumber';
import type { PageAnnotationsService } from './PageAnnotationsService';
import type { PageTextService } from './PageTextService';

/**
 * Page-scoped handle returned by `DocumentHandle.page(pageObjectNumber)`.
 * The handle is keyed on the PDF indirect object number, never the page
 * index, so it survives page-list mutations.
 */
export interface PageHandle {
  readonly pageObjectNumber: PageObjectNumber;
  /**
   * Display index at the time this handle was minted. The engine refreshes
   * this on every annotation/list call against the live `PageRecord`, but
   * callers should treat it as advisory metadata only.
   */
  readonly pageIndex: number;
  readonly annotations: PageAnnotationsService;
  readonly text: PageTextService;
}
