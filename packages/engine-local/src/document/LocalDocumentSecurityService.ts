import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  securityStateFromProbe,
  wirePack,
  type DocumentSecurityService,
  type DocumentSecurityState,
  type DocumentUnlockInput,
  type DocumentUnlockResult,
  type DocumentSecurityProbeInfo,
} from '@embedpdf/engine-core/runtime';
import type { WorkerQueue } from '../worker/WorkerQueue';
import { Priority } from '../worker/Priority';
import type { JobId, WorkerResultPayload } from '../worker/protocol';

export class LocalDocumentSecurityService implements DocumentSecurityService {
  private state: DocumentSecurityState;

  constructor(
    initial: DocumentSecurityProbeInfo,
    private readonly docId: string,
    private readonly queue: WorkerQueue,
    private readonly view: { isClosed(): boolean },
  ) {
    this.state = securityStateFromProbe(initial);
  }

  get current(): DocumentSecurityState {
    return this.state;
  }

  unlock(input: DocumentUnlockInput): AbortablePromise<DocumentUnlockResult> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    const submission = this.queue.enqueue<WorkerResultPayload>(
      {
        buildPack: (jobId: JobId) =>
          wirePack({
            kind: 'document.checkPasswordPermissions',
            jobId,
            docId: this.docId,
            password: input.password,
            mode: input.mode ?? 'any',
          }),
      },
      { priority: Priority.HIGH },
    );
    return AbortablePromise.run<DocumentUnlockResult>(async (signal) => {
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });

      const payload = await submission;
      if (payload.tag !== 'document.checkPasswordPermissions') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload tag: ${payload.tag}`);
      }
      this.state = securityStateFromProbe(payload.security);
      return { security: this.state };
    });
  }
}
