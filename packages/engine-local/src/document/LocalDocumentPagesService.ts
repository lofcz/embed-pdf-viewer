import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  wirePack,
  type DocumentPagesService,
  type PageListSnapshot,
  type PageMoveResult,
  type PageObjectNumber,
} from '@embedpdf/engine-core/runtime';
import type { WorkerQueue } from '../worker/WorkerQueue';
import { Priority } from '../worker/Priority';
import type { JobId, WorkerResultPayload } from '../worker/protocol';
import type { ScopeGuard } from '../scope';

interface DocClosedView {
  isClosed(): boolean;
}

/**
 * Document-scoped page service for the local engine. All work funnels
 * through the same in-process worker the rest of the engine uses, so
 * `pages.move()` is sequenced against any in-flight annotation
 * mutations: a page reorder cannot land while a write to one of those
 * pages is mid-flight, and the reorder is observed atomically by every
 * subsequent read.
 */
export class LocalDocumentPagesService implements DocumentPagesService {
  constructor(
    private readonly docId: string,
    private readonly queue: WorkerQueue,
    private readonly view: DocClosedView,
    private readonly guard: ScopeGuard,
  ) {}

  list(): AbortablePromise<PageListSnapshot> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    // pages.list maps to the cloud's /manifest endpoint: session-level
    // read gated by `doc.open`.
    try {
      this.guard.assertCapability('doc.open');
    } catch (err) {
      return AbortablePromise.rejectReason(err);
    }
    const docId = this.docId;
    const submission = this.queue.enqueue<WorkerResultPayload>(
      {
        buildPack: (jobId: JobId) => wirePack({ kind: 'pages.list', jobId, docId }),
      },
      { priority: Priority.MEDIUM },
    );
    return AbortablePromise.run<PageListSnapshot>(async (signal) => {
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      const payload = await submission;
      if (payload.tag !== 'pages.list') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload tag: ${payload.tag}`);
      }
      return payload.snapshot;
    });
  }

  move(pageObjectNumbers: PageObjectNumber[], destIndex: number): AbortablePromise<PageMoveResult> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    // pages.move maps to the cloud's POST /pages/move (gated by
    // `doc.pages.assemble`).
    try {
      this.guard.assertCapability('doc.pages.assemble');
    } catch (err) {
      return AbortablePromise.rejectReason(err);
    }
    const docId = this.docId;
    const submission = this.queue.enqueue<WorkerResultPayload>(
      {
        buildPack: (jobId: JobId) =>
          wirePack({
            kind: 'pages.move',
            jobId,
            docId,
            pageObjectNumbers,
            destIndex,
          }),
      },
      { priority: Priority.HIGH },
    );
    return AbortablePromise.run<PageMoveResult>(async (signal) => {
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      const payload = await submission;
      if (payload.tag !== 'pages.move') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload tag: ${payload.tag}`);
      }
      return payload.result;
    });
  }
}
