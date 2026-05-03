/**
 * Web Worker bootstrap for engine-local.
 *
 * This file is not part of the package's main bundle. Consumers wire it
 * up via Vite's `?worker` import (or a similar bundler primitive). At
 * runtime it:
 *   1. Creates the WASM runtime in this worker thread.
 *   2. Builds a WorkerHost wired to postMessage.
 *   3. Forwards every incoming postMessage to the host.
 *
 * Lives in src/ so consumers can import it as a worker source. It is NOT
 * exported by index.ts.
 */
import { createPdfRuntime } from '@embedpdf/pdf-runtime';
import { WorkerHost } from '@embedpdf/engine-services';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

(async () => {
  const runtime = await createPdfRuntime({ prefer: 'wasm' });
  const host = new WorkerHost(runtime, (msg: WorkerResponse) => {
    self.postMessage(msg);
  });

  self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    host.receive(event.data);
  };

  self.postMessage({ kind: 'ready' });
})().catch((err) => {
  self.postMessage({ kind: 'init-error', error: String(err?.stack ?? err) });
});

export {};
