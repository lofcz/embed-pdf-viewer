import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  type AnnotationDraft,
  type AnnotationListPageSnapshot,
  type AnnotationPatch,
  type AnnotationRef,
  type AnnotationCreateResult,
  type AnnotationDeleteResult,
  type AnnotationUpdateResult,
  type PageAnnotationsService,
  type PageObjectNumber,
} from '@embedpdf/engine-core';
import type { WorkerQueue } from '../worker/WorkerQueue';
import { Priority } from '../worker/Priority';
import type { JobId, WorkerResultPayload } from '../worker/protocol';

interface DocClosedView {
  isClosed(): boolean;
}

/**
 * Page-scoped annotation service. `list()` is the slow path (acquires a
 * pagePtr server-side). Mutation methods are typed but throw
 * `EngineError(NotImplemented)` until the next slice; the public
 * signatures are stable so consumers can be written against them today.
 */
export class LocalPageAnnotationsService implements PageAnnotationsService {
  constructor(
    private readonly docId: string,
    private readonly pageObjectNumber: PageObjectNumber,
    private readonly queue: WorkerQueue,
    private readonly view: DocClosedView,
  ) {}

  list(): AbortablePromise<AnnotationListPageSnapshot> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    const docId = this.docId;
    const pon = this.pageObjectNumber;
    const submission = this.queue.enqueue<WorkerResultPayload>(
      {
        buildRequest: (jobId: JobId) => ({
          kind: 'annotations.listFullPage',
          jobId,
          docId,
          pageObjectNumber: pon,
        }),
      },
      { priority: Priority.MEDIUM },
    );
    return AbortablePromise.run<AnnotationListPageSnapshot>(async (signal) => {
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      const payload = await submission;
      if (payload.tag !== 'annotations.listFullPage') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload tag: ${payload.tag}`);
      }
      return payload.snapshot;
    });
  }

  create(_draft: AnnotationDraft): AbortablePromise<AnnotationCreateResult> {
    return AbortablePromise.rejectReason(
      new EngineError(
        EngineErrorCode.NotImplemented,
        'annotation create is not implemented in this engine slice',
      ),
    );
  }

  update(_ref: AnnotationRef, _patch: AnnotationPatch): AbortablePromise<AnnotationUpdateResult> {
    return AbortablePromise.rejectReason(
      new EngineError(
        EngineErrorCode.NotImplemented,
        'annotation update is not implemented in this engine slice',
      ),
    );
  }

  delete(_ref: AnnotationRef): AbortablePromise<AnnotationDeleteResult> {
    return AbortablePromise.rejectReason(
      new EngineError(
        EngineErrorCode.NotImplemented,
        'annotation delete is not implemented in this engine slice',
      ),
    );
  }
}
