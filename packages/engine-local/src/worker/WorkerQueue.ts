import {
  AbortablePromise,
  AbortError,
  EngineError,
  EngineErrorCode,
  deserializeError,
} from '@embedpdf/engine-core';
import type { Transport } from '../transport/Transport';
import { IndexedPriorityHeap, type HeapHandle } from './IndexedPriorityHeap';
import { Priority } from './Priority';
import type {
  AbortRequest,
  JobId,
  WorkerRequest,
  WorkerResponse,
  WorkerResultPayload,
} from './protocol';

let _nextJobId = 1;
function nextJobId(): JobId {
  return _nextJobId++;
}

interface PendingJob {
  jobId: JobId;
  priority: number;
  buildRequest: (jobId: JobId) => WorkerRequest;
  transferables?: Transferable[];
  resolve: (payload: WorkerResultPayload) => void;
  reject: (err: unknown) => void;
  handle: HeapHandle;
}

interface InFlightJob {
  jobId: JobId;
  resolve: (payload: WorkerResultPayload) => void;
  reject: (err: unknown) => void;
  /**
   * Once true, any subsequent response from the worker is ignored and the
   * caller sees AbortError instead. This makes the abort contract hold
   * even when the host completes the work faster than the abort message
   * can propagate.
   */
  aborted: boolean;
  abortReason: unknown;
}

export interface EnqueueOptions {
  priority?: number;
  /** Number of dispatch slots the queue may use concurrently. */
  concurrency?: number;
}

export interface JobSpec {
  buildRequest: (jobId: JobId) => WorkerRequest;
  transferables?: Transferable[];
}

/**
 * Priority queue with O(log n) abort-removes-pending semantics.
 *
 * - enqueue() returns an AbortablePromise. Calling .abort() before
 *   dispatch removes the job from the heap (it never reaches the worker).
 * - Calling .abort() after dispatch sends an AbortRequest to the worker.
 *   The worker will reject when it next checks signal.aborted between
 *   PDFium calls, then we deliver an AbortError to the caller.
 */
export class WorkerQueue {
  private readonly pending = new Map<JobId, PendingJob>();
  private readonly inFlight = new Map<JobId, InFlightJob>();
  private readonly heap = new IndexedPriorityHeap<JobId>();
  private readonly unsubscribe: () => void;
  private readonly maxConcurrency: number;

  private destroyed = false;

  constructor(
    private readonly transport: Transport,
    opts: { concurrency?: number } = {},
  ) {
    this.maxConcurrency = Math.max(1, opts.concurrency ?? 1);
    this.unsubscribe = transport.onMessage((msg) => this.handleResponse(msg));
  }

  enqueue<R extends WorkerResultPayload>(
    spec: JobSpec,
    opts: EnqueueOptions = {},
  ): AbortablePromise<R> {
    if (this.destroyed) {
      return AbortablePromise.rejectReason<R>(
        new EngineError(EngineErrorCode.RuntimeUnavailable, 'engine has been destroyed'),
      );
    }
    const jobId = nextJobId();
    const priority = opts.priority ?? Priority.MEDIUM;

    return new AbortablePromise<R>((resolve, reject, _progress, signal) => {
      const handle = this.heap.push(jobId, priority);
      this.pending.set(jobId, {
        jobId,
        priority,
        buildRequest: spec.buildRequest,
        transferables: spec.transferables,
        handle,
        resolve: (payload) => resolve(payload as R),
        reject,
      });

      const onAbort = () => {
        const pending = this.pending.get(jobId);
        if (pending) {
          this.pending.delete(jobId);
          this.heap.remove(pending.handle);
          pending.reject(new AbortError(signal.reason));
          return;
        }
        const inFlight = this.inFlight.get(jobId);
        if (inFlight) {
          inFlight.aborted = true;
          inFlight.abortReason = signal.reason;
          const abortReq: AbortRequest = { kind: 'abort', jobId };
          this.transport.send(abortReq);
        }
      };

      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.tick();
    });
  }

  private tick(): void {
    if (this.destroyed) return;
    while (this.inFlight.size < this.maxConcurrency && this.heap.size > 0) {
      const jobId = this.heap.popMax();
      if (jobId === undefined) return;
      const pending = this.pending.get(jobId);
      if (!pending) continue; // tombstoned by abort
      this.pending.delete(jobId);

      const req = pending.buildRequest(jobId);
      this.inFlight.set(jobId, {
        jobId,
        resolve: pending.resolve,
        reject: pending.reject,
        aborted: false,
        abortReason: undefined,
      });
      this.transport.send(req, pending.transferables);
    }
  }

  private handleResponse(msg: WorkerResponse): void {
    const inFlight = this.inFlight.get(msg.jobId);
    if (!inFlight) return; // stale or already aborted
    this.inFlight.delete(msg.jobId);

    if (inFlight.aborted) {
      inFlight.reject(new AbortError(inFlight.abortReason));
    } else if (msg.kind === 'resolve') {
      inFlight.resolve(msg.result);
    } else {
      const err = deserializeError(msg.error);
      if (err.code === EngineErrorCode.Aborted) {
        inFlight.reject(new AbortError(err.message));
      } else {
        inFlight.reject(err);
      }
    }

    this.tick();
  }

  async shutdown(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    // Reject anything still pending.
    for (const pending of this.pending.values()) {
      this.heap.remove(pending.handle);
      pending.reject(new EngineError(EngineErrorCode.RuntimeUnavailable, 'engine destroyed'));
    }
    this.pending.clear();

    // In-flight: best-effort send shutdown then settle.
    try {
      const id = nextJobId();
      const settle = new Promise<void>((resolveSettle) => {
        const off = this.transport.onMessage((m) => {
          if (m.jobId === id) {
            off();
            resolveSettle();
          }
        });
        this.transport.send({ kind: 'shutdown', jobId: id });
      });
      await Promise.race([settle, new Promise<void>((r) => setTimeout(r, 50))]);
    } catch {
      // ignore
    }

    for (const inFlight of this.inFlight.values()) {
      inFlight.reject(new EngineError(EngineErrorCode.RuntimeUnavailable, 'engine destroyed'));
    }
    this.inFlight.clear();

    this.unsubscribe();
    await this.transport.terminate();
  }
}
