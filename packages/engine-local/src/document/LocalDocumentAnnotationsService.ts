import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  wirePack,
  type AnnotationListPageSnapshot,
  type AnnotationListSnapshotAllPages,
  type DocumentAnnotationsService,
  type PageObjectNumber,
} from '@embedpdf/engine-core';
import type { WorkerQueue } from '../worker/WorkerQueue';
import { Priority } from '../worker/Priority';
import type { JobId, WorkerResultPayload } from '../worker/protocol';

interface DocClosedView {
  isClosed(): boolean;
}

/**
 * Document-scoped annotation reads, dispatched through the same
 * WorkerQueue every other local read uses. The worker host fans out to
 * `RawAnnotationReader.listAll` / `RawAnnotationReader.listOne`.
 */
export class LocalDocumentAnnotationsService implements DocumentAnnotationsService {
  constructor(
    private readonly docId: string,
    private readonly queue: WorkerQueue,
    private readonly view: DocClosedView,
  ) {}

  listRawAll(): AbortablePromise<AnnotationListSnapshotAllPages> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    const docId = this.docId;
    const submission = this.queue.enqueue<WorkerResultPayload>(
      {
        buildPack: (jobId: JobId) => wirePack({ kind: 'annotations.listRawAll', jobId, docId }),
      },
      { priority: Priority.MEDIUM },
    );
    return AbortablePromise.run<AnnotationListSnapshotAllPages>(async (signal) => {
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      const payload = await submission;
      if (payload.tag !== 'annotations.listRawAll') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload tag: ${payload.tag}`);
      }
      return payload.snapshot;
    });
  }

  listRaw(pageObjectNumber: PageObjectNumber): AbortablePromise<AnnotationListPageSnapshot> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    const docId = this.docId;
    const submission = this.queue.enqueue<WorkerResultPayload>(
      {
        buildPack: (jobId: JobId) =>
          wirePack({
            kind: 'annotations.listRawPage',
            jobId,
            docId,
            pageObjectNumber,
          }),
      },
      { priority: Priority.MEDIUM },
    );
    return AbortablePromise.run<AnnotationListPageSnapshot>(async (signal) => {
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      const payload = await submission;
      if (payload.tag !== 'annotations.listRawPage') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload tag: ${payload.tag}`);
      }
      return payload.snapshot;
    });
  }
}
