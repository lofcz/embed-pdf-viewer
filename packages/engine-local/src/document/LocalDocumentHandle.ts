import {
  AbortablePromise,
  wirePack,
  type DocumentAnnotationsService,
  type DocumentHandle,
  type DocumentPagesService,
  type MetadataService,
  type PageHandle,
  type PageObjectNumber,
} from '@embedpdf/engine-core/runtime';
import type { WorkerQueue } from '../worker/WorkerQueue';
import { Priority } from '../worker/Priority';
import type { JobId, WorkerResultPayload } from '../worker/protocol';
import { LocalMetadataService } from './LocalMetadataService';
import { LocalDocumentAnnotationsService } from './LocalDocumentAnnotationsService';
import { LocalDocumentPagesService } from './LocalDocumentPagesService';
import { LocalPageHandle } from './LocalPageHandle';

export class LocalDocumentHandle implements DocumentHandle {
  readonly capabilities = {
    weakAnnotationEditSessions: 'not-needed',
    pageEditSessions: 'unsupported',
  } as const;
  readonly metadata: MetadataService;
  readonly annotations: DocumentAnnotationsService;
  readonly pages: DocumentPagesService;
  private closed = false;

  constructor(
    readonly id: string,
    private readonly queue: WorkerQueue,
  ) {
    const view = { isClosed: () => this.closed };
    this.metadata = new LocalMetadataService(id, queue, view);
    this.annotations = new LocalDocumentAnnotationsService(id, queue, view);
    this.pages = new LocalDocumentPagesService(id, queue, view);
  }

  /**
   * Returns a `PageHandle` keyed on the page's PDF indirect object
   * number. We don't validate the page exists synchronously - the worker
   * does that on the next call. This matches the cloud engine, which
   * cannot validate without a round-trip either.
   *
   * `pageIndex` is reported as `-1` until the first read, when the
   * snapshot's `pageState.pageIndex` overrides it. Clients that need
   * accurate display order should read from `snapshot.pageState`.
   */
  page(pageObjectNumber: PageObjectNumber): PageHandle {
    return new LocalPageHandle(pageObjectNumber, -1, this.id, this.queue, {
      isClosed: () => this.closed,
    });
  }

  close(): AbortablePromise<void> {
    if (this.closed) {
      return AbortablePromise.resolveValue<void>(undefined);
    }
    this.closed = true;
    const docId = this.id;
    const submission = this.queue.enqueue<WorkerResultPayload>(
      {
        buildPack: (jobId: JobId) => wirePack({ kind: 'close', jobId, docId }),
      },
      { priority: Priority.HIGH },
    );
    return AbortablePromise.run<void>(async (signal) => {
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      await submission;
    });
  }
}
