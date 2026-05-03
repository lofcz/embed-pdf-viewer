import { AbortablePromise, type DocumentHandle, type MetadataService } from '@embedpdf/engine-core';
import type { WorkerQueue } from '../worker/WorkerQueue';
import { Priority } from '../worker/Priority';
import type { JobId, WorkerResultPayload } from '../worker/protocol';
import { LocalMetadataService } from './LocalMetadataService';

export class LocalDocumentHandle implements DocumentHandle {
  readonly metadata: MetadataService;
  private closed = false;

  constructor(
    readonly id: string,
    private readonly queue: WorkerQueue,
  ) {
    this.metadata = new LocalMetadataService(id, queue, {
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
        buildRequest: (jobId: JobId) => ({ kind: 'close', jobId, docId }),
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
