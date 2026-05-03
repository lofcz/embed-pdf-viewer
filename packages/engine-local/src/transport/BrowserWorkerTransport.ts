import type { WorkerRequest, WorkerResponse } from '../worker/protocol';
import type { Transport } from './Transport';

interface InitReadyMsg {
  kind: 'ready';
}
interface InitErrorMsg {
  kind: 'init-error';
  error: string;
}

/**
 * Browser-only Web Worker transport. The worker is spawned externally and
 * passed in here, which keeps this package independent of any specific
 * bundler primitive (Vite's `?worker`, Webpack 5's `new URL(...)`, etc.).
 *
 * The worker entry is in src/worker/worker-entry.ts and consumers wire it
 * up using their bundler's worker convention.
 */
export class BrowserWorkerTransport implements Transport {
  private readonly listeners = new Set<(msg: WorkerResponse) => void>();
  private readonly onMessageBound: (e: MessageEvent) => void;

  static async spawn(worker: Worker): Promise<BrowserWorkerTransport> {
    const transport = new BrowserWorkerTransport(worker);
    await transport.waitForReady();
    return transport;
  }

  private constructor(private readonly worker: Worker) {
    this.onMessageBound = (e: MessageEvent) => this.handleMessage(e);
    worker.addEventListener('message', this.onMessageBound);
  }

  send(req: WorkerRequest, transferables?: Transferable[]): void {
    if (transferables && transferables.length > 0) {
      this.worker.postMessage(req, transferables);
    } else {
      this.worker.postMessage(req);
    }
  }

  onMessage(handler: (msg: WorkerResponse) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  async terminate(): Promise<void> {
    this.worker.removeEventListener('message', this.onMessageBound);
    this.listeners.clear();
    this.worker.terminate();
  }

  private handleMessage(e: MessageEvent): void {
    const data = e.data as WorkerResponse | InitReadyMsg | InitErrorMsg;
    if (!data || typeof data !== 'object' || !('kind' in data)) return;
    if (data.kind === 'ready' || data.kind === 'init-error') return;
    for (const fn of this.listeners) {
      try {
        fn(data);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  private waitForReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onReady = (e: MessageEvent) => {
        const data = e.data as InitReadyMsg | InitErrorMsg;
        if (!data || typeof data !== 'object' || !('kind' in data)) return;
        if (data.kind === 'ready') {
          this.worker.removeEventListener('message', onReady);
          resolve();
        } else if (data.kind === 'init-error') {
          this.worker.removeEventListener('message', onReady);
          reject(new Error(`worker failed to initialize: ${data.error}`));
        }
      };
      this.worker.addEventListener('message', onReady);
    });
  }
}
