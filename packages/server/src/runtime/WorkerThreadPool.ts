import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import {
  AbortError,
  EngineError,
  EngineErrorCode,
  deserializeError,
  wirePack,
  type WirePack,
  type WorkerJobId,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerResultPayload,
} from '@embedpdf/engine-core';

let _nextJobId = 1;
function nextJobId(): WorkerJobId {
  return _nextJobId++;
}

interface WorkerSlot {
  index: number;
  worker: Worker;
  ready: Promise<void>;
  inFlight: Map<
    WorkerJobId,
    {
      resolve: (p: WorkerResultPayload) => void;
      reject: (e: unknown) => void;
      aborted: boolean;
      abortReason: unknown;
    }
  >;
  /** docIds currently bound to this worker. Used for sticky routing. */
  docIds: Set<string>;
}

export interface WorkerThreadPoolOptions {
  size?: number;
  /**
   * Location of the worker_thread entry script. Required because Vite's
   * library-mode bundling places shared code in chunks at runtime, so a
   * relative `import.meta.url` lookup from this file is not stable. The
   * default is provided by the package entry (see src/index.ts).
   */
  workerEntry: URL | string;
}

/**
 * worker_thread pool with sticky-by-docId routing.
 *
 * - open(docId) picks the least-loaded worker and binds the docId to it
 * - subsequent calls referencing that docId always go to the same worker
 * - close(docId) releases the binding
 *
 * Mirrors the WorkerQueue contract from engine-local on the cancellation
 * side: aborts during in-flight calls are best-effort, and the pool
 * still rejects with AbortError once the response arrives if the caller
 * aborted before it landed.
 */
export class WorkerThreadPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly docToSlot = new Map<string, number>();
  private destroyed = false;

  static async create(opts: WorkerThreadPoolOptions): Promise<WorkerThreadPool> {
    const pool = new WorkerThreadPool();
    const size = Math.max(1, opts.size ?? Math.min(2, Math.max(1, cpus().length)));
    const entry = opts.workerEntry;

    for (let i = 0; i < size; i++) {
      const worker = new Worker(entry);
      const slot: WorkerSlot = {
        index: i,
        worker,
        ready: waitForReady(worker),
        inFlight: new Map(),
        docIds: new Set(),
      };
      worker.on(
        'message',
        (msg: WorkerResponse | { kind: 'ready' } | { kind: 'init-error'; error: string }) => {
          if (!msg || typeof msg !== 'object' || !('kind' in msg)) return;
          if (msg.kind === 'ready' || msg.kind === 'init-error') return;
          const handler = slot.inFlight.get(msg.jobId);
          if (!handler) return;
          slot.inFlight.delete(msg.jobId);
          if (handler.aborted) {
            handler.reject(new AbortError(handler.abortReason));
            return;
          }
          if (msg.kind === 'resolve') {
            handler.resolve(msg.result);
          } else {
            handler.reject(deserializeError(msg.error));
          }
        },
      );
      worker.on('error', (err) => {
        for (const handler of slot.inFlight.values()) handler.reject(err);
        slot.inFlight.clear();
      });
      pool.slots.push(slot);
    }
    await Promise.all(pool.slots.map((s) => s.ready));
    return pool;
  }

  /**
   * Open a new document on the least-loaded worker.
   *
   * The route is responsible for producing the `WirePack<OpenWorkerRequest>`
   * — typically `wirePack(openReq, [bytes.buffer])` — because the route
   * is the layer that already holds the `Buffer`/`Uint8Array` and knows
   * which `ArrayBuffer` slice should move zero-copy to the worker. The
   * pool no longer copies/slices the bytes; it just binds the docId to
   * a worker slot and dispatches the pre-packed request.
   */
  async runOpen(
    docId: string,
    build: (jobId: WorkerJobId) => WirePack<WorkerRequest>,
    signal?: AbortSignal,
  ): Promise<WorkerResultPayload> {
    if (this.destroyed) throw new EngineError(EngineErrorCode.RuntimeUnavailable, 'pool destroyed');
    if (this.docToSlot.has(docId)) {
      throw new EngineError(EngineErrorCode.InvalidArg, `docId already open: ${docId}`);
    }
    const slot = this.pickLeastLoaded();
    slot.docIds.add(docId);
    this.docToSlot.set(docId, slot.index);
    try {
      return await this.dispatchToSlot(slot, build, signal);
    } catch (err) {
      slot.docIds.delete(docId);
      this.docToSlot.delete(docId);
      throw err;
    }
  }

  /** Run a sticky call against the worker that owns the docId. */
  async run(
    docId: string,
    build: (jobId: WorkerJobId) => WirePack<WorkerRequest>,
    signal?: AbortSignal,
  ): Promise<WorkerResultPayload> {
    if (this.destroyed) throw new EngineError(EngineErrorCode.RuntimeUnavailable, 'pool destroyed');
    const idx = this.docToSlot.get(docId);
    if (idx === undefined) {
      throw new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${docId}`);
    }
    const slot = this.slots[idx]!;
    return this.dispatchToSlot(slot, build, signal);
  }

  /** Close the document and release the sticky binding. */
  async close(docId: string, signal?: AbortSignal): Promise<WorkerResultPayload | null> {
    if (this.destroyed) return null;
    const idx = this.docToSlot.get(docId);
    if (idx === undefined) return null;
    const slot = this.slots[idx]!;
    try {
      const r = await this.dispatchToSlot(
        slot,
        // close carries no buffers — pack with the shared empty transfer.
        (jobId) => wirePack({ kind: 'close', jobId, docId }),
        signal,
      );
      return r;
    } finally {
      slot.docIds.delete(docId);
      this.docToSlot.delete(docId);
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const slot of this.slots) {
      const jobId = nextJobId();
      try {
        await new Promise<void>((resolve) => {
          const onMsg = (msg: WorkerResponse) => {
            if (msg && typeof msg === 'object' && 'jobId' in msg && msg.jobId === jobId) {
              slot.worker.off('message', onMsg);
              resolve();
            }
          };
          slot.worker.on('message', onMsg);
          slot.worker.postMessage({ kind: 'shutdown', jobId } as WorkerRequest);
          setTimeout(() => {
            slot.worker.off('message', onMsg);
            resolve();
          }, 250);
        });
      } catch {
        // ignore
      }
      try {
        await slot.worker.terminate();
      } catch {
        // ignore
      }
    }
  }

  private pickLeastLoaded(): WorkerSlot {
    let best = this.slots[0]!;
    for (const s of this.slots) {
      if (s.docIds.size < best.docIds.size) best = s;
    }
    return best;
  }

  private dispatchToSlot(
    slot: WorkerSlot,
    build: (jobId: WorkerJobId) => WirePack<WorkerRequest>,
    signal?: AbortSignal,
  ): Promise<WorkerResultPayload> {
    const jobId = nextJobId();
    const pack = build(jobId);
    return new Promise<WorkerResultPayload>((resolve, reject) => {
      const handler = { resolve, reject, aborted: false, abortReason: undefined as unknown };
      slot.inFlight.set(jobId, handler);

      const onAbort = () => {
        handler.aborted = true;
        handler.abortReason = signal?.reason;
        try {
          slot.worker.postMessage({ kind: 'abort', jobId } as WorkerRequest);
        } catch {
          // ignore
        }
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      try {
        // `pack.transfer` is the producer's authoritative manifest. We
        // narrow to `readonly ArrayBuffer[]` at the boundary because
        // Node's `worker_threads.postMessage` typing accepts a transfer
        // list of `ArrayBuffer | MessagePort`, and ArrayBuffer is the
        // only kind we currently move across this seam.
        slot.worker.postMessage(pack.payload, pack.transfer as readonly ArrayBuffer[]);
      } catch (err) {
        slot.inFlight.delete(jobId);
        reject(err);
      }
    });
  }
}

function waitForReady(worker: Worker): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onMsg = (msg: { kind?: string; error?: string }) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.kind === 'ready') {
        worker.off('message', onMsg);
        resolve();
      } else if (msg.kind === 'init-error') {
        worker.off('message', onMsg);
        reject(new Error(`worker failed to initialize: ${msg.error}`));
      }
    };
    worker.on('message', onMsg);
    worker.once('error', reject);
  });
}
