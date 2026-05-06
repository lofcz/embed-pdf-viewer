import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  wirePack,
  type DocumentMetadata,
  type MetadataService,
} from '@embedpdf/engine-core';
import type { WorkerQueue } from '../worker/WorkerQueue';
import { Priority } from '../worker/Priority';
import type { JobId, WorkerResultPayload } from '../worker/protocol';

interface DocClosedView {
  isClosed(): boolean;
}

export class LocalMetadataService implements MetadataService {
  constructor(
    private readonly docId: string,
    private readonly queue: WorkerQueue,
    private readonly view: DocClosedView,
  ) {}

  read(): AbortablePromise<DocumentMetadata> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    const docId = this.docId;
    const submission = this.queue.enqueue<WorkerResultPayload>(
      {
        buildPack: (jobId: JobId) => wirePack({ kind: 'metadata.read', jobId, docId }),
      },
      { priority: Priority.MEDIUM },
    );
    return AbortablePromise.run<DocumentMetadata>(async (signal) => {
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });

      const payload = await submission;
      if (payload.tag !== 'metadata.read') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload tag: ${payload.tag}`);
      }
      return payload.metadata;
    });
  }
}
