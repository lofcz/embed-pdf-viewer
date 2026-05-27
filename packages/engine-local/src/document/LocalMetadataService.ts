import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  wirePack,
  type DocumentMetadata,
  type MetadataService,
} from '@embedpdf/engine-core/runtime';
import type { WorkerQueue } from '../worker/WorkerQueue';
import { Priority } from '../worker/Priority';
import type { JobId, WorkerResultPayload } from '../worker/protocol';
import type { ScopeGuard } from '../scope';

interface DocClosedView {
  isClosed(): boolean;
}

export class LocalMetadataService implements MetadataService {
  constructor(
    private readonly docId: string,
    private readonly queue: WorkerQueue,
    private readonly view: DocClosedView,
    private readonly guard: ScopeGuard,
  ) {}

  read(): AbortablePromise<DocumentMetadata> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    // Metadata read is session-level — same gate as /head/manifest on
    // the cloud (`doc.open`). The metadata routes use
    // `requireLayerCapability('doc.open', ...)`.
    try {
      this.guard.assertCapability('doc.open');
    } catch (err) {
      return AbortablePromise.rejectReason(err);
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
