import type { WorkerRequest, WorkerResponse } from '../worker/protocol';

/**
 * The pluggable boundary between the WorkerQueue (lives on the main thread)
 * and the WorkerHost (which actually runs PDFium). Both real Web Workers and
 * an in-process inline worker satisfy this interface.
 */
export interface Transport {
  /** Send a request to the host. May be sync or async transport. */
  send(req: WorkerRequest, transferables?: Transferable[]): void;

  /** Subscribe to responses. Returns an unsubscribe function. */
  onMessage(handler: (msg: WorkerResponse) => void): () => void;

  /** Tear down the transport. */
  terminate(): Promise<void>;
}
