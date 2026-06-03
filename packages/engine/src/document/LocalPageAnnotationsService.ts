import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  wirePack,
  type AnnotationDraft,
  type AnnotationListPageSnapshot,
  type AnnotationPatch,
  type AnnotationRef,
  type AnnotationCreateResult,
  type AnnotationDeleteResult,
  type AnnotationMoveResult,
  type AnnotationUpdateResult,
  type CollabTarget,
  type PageAnnotationsService,
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
 * Page-scoped annotation service. `list()` is the slow path (acquires a
 * pagePtr server-side). Mutation methods are wired to the in-process
 * worker; the worker host runs `AnnotationMutator` synchronously
 * inside the same PDFium runtime instance the read path uses, so create
 * sees its own writes immediately.
 */
export class LocalPageAnnotationsService implements PageAnnotationsService {
  constructor(
    private readonly docId: string,
    private readonly pageObjectNumber: PageObjectNumber,
    private readonly queue: WorkerQueue,
    private readonly view: DocClosedView,
    private readonly guard: ScopeGuard,
  ) {}

  list(): AbortablePromise<AnnotationListPageSnapshot> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    // Reading annotations gates on `doc.annotate.read` — same as the
    // cloud's annotations-read resource.
    try {
      this.guard.assertCapability('doc.annotate.read');
    } catch (err) {
      return AbortablePromise.rejectReason(err);
    }
    const docId = this.docId;
    const pon = this.pageObjectNumber;
    const submission = this.queue.enqueue<WorkerResultPayload>(
      {
        buildPack: (jobId: JobId) =>
          wirePack({
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

  create(draft: AnnotationDraft): AbortablePromise<AnnotationCreateResult> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    // Cloud parity for POST /annotations: creation is gated by an
    // `annotations:create:filter` collab scope (target is the handle's
    // own identity). Under the narrowing model, presence of `modify`
    // also satisfies create when no create-collab is given.
    try {
      const target = this.guard.targetForSelfCreate();
      this.guard.assertCollab('create', target);
    } catch (err) {
      return AbortablePromise.rejectReason(err);
    }
    const actor = this.guard.actorForCreate();

    const docId = this.docId;
    const pon = this.pageObjectNumber;
    const submission = this.queue.enqueue<WorkerResultPayload>(
      {
        buildPack: (jobId: JobId) =>
          wirePack({
            kind: 'annotations.create',
            jobId,
            docId,
            pageObjectNumber: pon,
            draft,
            ...(actor ? { actor } : {}),
          }),
      },
      { priority: Priority.HIGH },
    );
    return AbortablePromise.run<AnnotationCreateResult>(async (signal) => {
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      const payload = await submission;
      if (payload.tag !== 'annotations.create') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload tag: ${payload.tag}`);
      }
      return payload.result;
    });
  }

  update(ref: AnnotationRef, patch: AnnotationPatch): AbortablePromise<AnnotationUpdateResult> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    return AbortablePromise.run<AnnotationUpdateResult>(async (signal) => {
      // Look up the target row's collab identity before the mutation so
      // the collab check can fire against the existing /EMBD_Metadata.
      // V1 approach: page-fetch + filter — same as the cloud's
      // `LayerService.getAnnotationCollabTarget`. Optimizable to a
      // targeted worker job later.
      const target = await this.collabTargetForRef(ref, signal);
      this.guard.assertCollab('update', target);

      // Group reassignment runs `:set-group` against the caller's
      // default group before building the actor (cloud PATCH parity).
      const patchGroupId = (patch as { groupId?: string }).groupId;
      const isReassigning = typeof patchGroupId === 'string' && patchGroupId !== target.groupId;
      if (isReassigning) {
        this.guard.assertSetGroup(patchGroupId);
      }
      const actor = this.guard.actorForUpdate(target.groupId, patchGroupId);

      const docId = this.docId;
      const submission = this.queue.enqueue<WorkerResultPayload>(
        {
          buildPack: (jobId: JobId) =>
            wirePack({
              kind: 'annotations.update',
              jobId,
              docId,
              ref,
              patch,
              ...(actor ? { actor } : {}),
            }),
        },
        { priority: Priority.HIGH },
      );
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      const payload = await submission;
      if (payload.tag !== 'annotations.update') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload tag: ${payload.tag}`);
      }
      return payload.result;
    });
  }

  delete(ref: AnnotationRef): AbortablePromise<AnnotationDeleteResult> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    return AbortablePromise.run<AnnotationDeleteResult>(async (signal) => {
      const target = await this.collabTargetForRef(ref, signal);
      this.guard.assertCollab('delete', target);

      const docId = this.docId;
      const submission = this.queue.enqueue<WorkerResultPayload>(
        {
          buildPack: (jobId: JobId) =>
            wirePack({
              kind: 'annotations.delete',
              jobId,
              docId,
              ref,
            }),
        },
        { priority: Priority.HIGH },
      );
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      const payload = await submission;
      if (payload.tag !== 'annotations.delete') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload tag: ${payload.tag}`);
      }
      return payload.result;
    });
  }

  move(refs: AnnotationRef[], toIndex: number): AbortablePromise<AnnotationMoveResult> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${this.docId}`),
      );
    }
    // Move is a structural reorder — gates on `doc.annotate.modify`,
    // not on per-record collab (no specific target to check). For
    // wildcard / admin tokens, this passes trivially.
    try {
      this.guard.assertCapability('doc.annotate.modify');
    } catch (err) {
      return AbortablePromise.rejectReason(err);
    }
    const docId = this.docId;
    const pon = this.pageObjectNumber;
    const submission = this.queue.enqueue<WorkerResultPayload>(
      {
        buildPack: (jobId: JobId) =>
          wirePack({
            kind: 'annotations.move',
            jobId,
            docId,
            pageObjectNumber: pon,
            refs,
            toIndex,
          }),
      },
      { priority: Priority.HIGH },
    );
    return AbortablePromise.run<AnnotationMoveResult>(async (signal) => {
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      const payload = await submission;
      if (payload.tag !== 'annotations.move') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload tag: ${payload.tag}`);
      }
      return payload.result;
    });
  }

  /**
   * Resolve the collab subject (userId / groupId) of the target row
   * an UPDATE or DELETE is about to act on. Mirrors the cloud's
   * `LayerService.getAnnotationCollabTarget` — page-fetch + filter
   * over the existing listFullPage worker job. Returns `{}` when the
   * row can't be located; the collab resolver then denies
   * `:self`/`:group=X` filters and the mutator's own InvalidReference
   * surfaces the real error.
   */
  private async collabTargetForRef(ref: AnnotationRef, signal: AbortSignal): Promise<CollabTarget> {
    const submission = this.queue.enqueue<WorkerResultPayload>(
      {
        buildPack: (jobId: JobId) =>
          wirePack({
            kind: 'annotations.listFullPage',
            jobId,
            docId: this.docId,
            pageObjectNumber: ref.pageObjectNumber,
          }),
      },
      { priority: Priority.MEDIUM },
    );
    const onAbort = () => submission.abort(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });

    const payload = await submission;
    if (payload.tag !== 'annotations.listFullPage') {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `unexpected payload tag while resolving collab target: ${payload.tag}`,
      );
    }
    const match = payload.snapshot.annotations.find((a) => {
      switch (ref.kind) {
        case 'objectNumber':
          return a.ref.kind === 'objectNumber' && a.ref.annotObjectNumber === ref.annotObjectNumber;
        case 'nm':
          return a.nm === ref.nm;
        case 'index':
          return a.index === ref.index;
      }
    });
    if (!match) return {};
    return {
      ...(match.userId !== undefined ? { userId: match.userId } : {}),
      ...(match.groupId !== undefined ? { groupId: match.groupId } : {}),
    };
  }
}
