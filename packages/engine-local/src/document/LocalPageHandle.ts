import type { PageHandle, PageObjectNumber } from '@embedpdf/engine-core/runtime';
import { LocalPageAnnotationsService } from './LocalPageAnnotationsService';
import { LocalPageGeometryService } from './LocalPageGeometryService';
import { LocalPageTextService } from './LocalPageTextService';
import type { WorkerQueue } from '../worker/WorkerQueue';

interface DocClosedView {
  isClosed(): boolean;
}

/**
 * Local page handle. `pageIndex` is supplied as advisory metadata when
 * the document handle creates the page handle. The per-page services
 * each own their queue interaction; the handle is otherwise stateless.
 */
export class LocalPageHandle implements PageHandle {
  readonly annotations: LocalPageAnnotationsService;
  readonly text: LocalPageTextService;
  readonly geometry: LocalPageGeometryService;

  constructor(
    readonly pageObjectNumber: PageObjectNumber,
    readonly pageIndex: number,
    docId: string,
    queue: WorkerQueue,
    view: DocClosedView,
  ) {
    this.annotations = new LocalPageAnnotationsService(docId, pageObjectNumber, queue, view);
    this.text = new LocalPageTextService(docId, pageObjectNumber, queue, view);
    this.geometry = new LocalPageGeometryService(docId, pageObjectNumber, queue, view);
  }
}
