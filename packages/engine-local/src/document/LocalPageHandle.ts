import type { PageHandle, PageObjectNumber } from '@embedpdf/engine-core';
import { LocalPageAnnotationsService } from './LocalPageAnnotationsService';
import type { WorkerQueue } from '../worker/WorkerQueue';

interface DocClosedView {
  isClosed(): boolean;
}

/**
 * Local page handle. `pageIndex` is supplied as advisory metadata when
 * the document handle creates the page handle. The annotations service
 * owns its own queue interaction; the handle is otherwise stateless.
 */
export class LocalPageHandle implements PageHandle {
  readonly annotations: LocalPageAnnotationsService;

  constructor(
    readonly pageObjectNumber: PageObjectNumber,
    readonly pageIndex: number,
    docId: string,
    queue: WorkerQueue,
    view: DocClosedView,
  ) {
    this.annotations = new LocalPageAnnotationsService(docId, pageObjectNumber, queue, view);
  }
}
