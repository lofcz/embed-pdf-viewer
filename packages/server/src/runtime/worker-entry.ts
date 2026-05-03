/**
 * Server-side worker_thread entry. Thin Node adapter around the shared
 * WorkerHost from @embedpdf/engine-services. The host owns all
 * open/metadata/close/shutdown dispatch; this file only handles Node
 * concerns: parentPort plumbing, native PDFium runtime creation, the
 * ready/init-error lifecycle messages the WorkerThreadPool waits on, and
 * the process.exit after a successful shutdown so the worker_thread can
 * terminate cleanly.
 */
import { parentPort } from 'node:worker_threads';
import { createPdfRuntime } from '@embedpdf/pdf-runtime';
import { WorkerHost } from '@embedpdf/engine-services';
import type { WorkerRequest, WorkerResponse } from '@embedpdf/engine-core';

if (!parentPort) {
  throw new Error('worker-entry must be loaded as a worker_thread');
}

const port = parentPort;

(async () => {
  const runtime = await createPdfRuntime({ prefer: 'native' });
  const host = new WorkerHost(runtime, (msg: WorkerResponse) => port.postMessage(msg));

  port.on('message', (msg: WorkerRequest) => {
    host.receive(msg);
    if (msg.kind === 'shutdown') {
      // Allow the resolve message posted by the host to flush before exit.
      setTimeout(() => process.exit(0), 10);
    }
  });

  port.postMessage({ kind: 'ready' });
})().catch((err: unknown) => {
  port.postMessage({ kind: 'init-error', error: String((err as Error)?.stack ?? err) });
});
