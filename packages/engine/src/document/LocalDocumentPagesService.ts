import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  wirePack,
  type DocumentPagesService,
  type PageDeleteResult,
  type PageListSnapshot,
  type PageMoveResult,
  type PageObjectNumber,
  type PageRotateResult,
  type PageRotation,
} from '@embedpdf/engine-core/runtime';
import type { SessionEventPublisher } from '@embedpdf/engine-services';
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
    private readonly publisher: SessionEventPublisher,
  ) {}

  list(): AbortablePromise<PageListSnapshot> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    // pages.list is the page-geometry read: a session-level read gated by
    // `doc.open` (mirrors the cloud's /layout endpoint, which is itself
    // gated behind the manifest's `doc.open` read).
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
      this.publisher.publishLocal({
        type: 'pages.moved',
        pageObjectNumbers,
        destIndex,
        ...payload.result,
      });
      return payload.result;
    });
  }

  rotate(
    pageObjectNumbers: PageObjectNumber[],
    rotation: PageRotation,
  ): AbortablePromise<PageRotateResult> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    // pages.rotate maps to the cloud's POST /pages/rotate (gated by
    // `doc.pages.assemble`, like every page-structure verb).
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
            kind: 'pages.rotate',
            jobId,
            docId,
            pageObjectNumbers,
            rotation,
          }),
      },
      { priority: Priority.HIGH },
    );
    return AbortablePromise.run<PageRotateResult>(async (signal) => {
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      const payload = await submission;
      if (payload.tag !== 'pages.rotate') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload tag: ${payload.tag}`);
      }
      this.publisher.publishLocal({
        type: 'pages.rotated',
        pageObjectNumbers,
        rotation,
        ...payload.result,
      });
      return payload.result;
    });
  }

  delete(pageObjectNumbers: PageObjectNumber[]): AbortablePromise<PageDeleteResult> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    // pages.delete maps to the cloud's POST /pages/delete (gated by
    // `doc.pages.assemble`, like every page-structure verb).
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
            kind: 'pages.delete',
            jobId,
            docId,
            pageObjectNumbers,
          }),
      },
      { priority: Priority.HIGH },
    );
    return AbortablePromise.run<PageDeleteResult>(async (signal) => {
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      const payload = await submission;
      if (payload.tag !== 'pages.delete') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload tag: ${payload.tag}`);
      }
      this.publisher.publishLocal({
        type: 'pages.deleted',
        pageObjectNumbers,
        ...payload.result,
      });
      return payload.result;
    });
  }
}
