import type { PdfRuntimeModule } from '@embedpdf/pdf-runtime';
import { WorkerHost } from '@embedpdf/engine-services';
import type { WorkerRequest, WorkerResponse } from '../worker/protocol';
import type { Transport } from './Transport';

/**
 * Inline transport: runs the WorkerHost in the same JS thread as the queue.
 * Dispatch is asynchronous (queueMicrotask) so callers always observe
 * Promise-style ordering: synchronous code completes before any handler runs.
 *
 * Used by:
 *   - Node demos and conformance tests (no Web Worker available)
 *   - Browser fallback when the user opts out of workers
 *   - Future: server's worker_thread will use a thin shim around this shape
 */
export class InlineTransport implements Transport {
  private readonly host: WorkerHost;
  private readonly listeners = new Set<(msg: WorkerResponse) => void>();
  private destroyed = false;

  constructor(runtime: PdfRuntimeModule) {
    this.host = new WorkerHost(runtime, (msg) => this.deliver(msg));
  }

  send(req: WorkerRequest, _transferables?: Transferable[]): void {
    if (this.destroyed) return;
    queueMicrotask(() => {
      if (this.destroyed) return;
      this.host.receive(req);
    });
  }

  onMessage(handler: (msg: WorkerResponse) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  async terminate(): Promise<void> {
    this.destroyed = true;
    this.listeners.clear();
  }

  private deliver(msg: WorkerResponse): void {
    for (const fn of this.listeners) {
      try {
        fn(msg);
      } catch {
        // swallow listener errors
      }
    }
  }
}
