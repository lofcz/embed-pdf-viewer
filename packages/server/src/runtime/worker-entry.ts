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
import type { WirePack, WorkerRequest, WorkerResponse } from '@embedpdf/engine-core/runtime';

if (!parentPort) {
  throw new Error('worker-entry must be loaded as a worker_thread');
}

const port = parentPort;

(async () => {
  const runtime = await createPdfRuntime({ prefer: 'native' });
  // Node's `worker_threads` accepts a `transferList` second argument
  // (typed as `readonly TransferListItem[]`, which is structurally
  // `ArrayBuffer | MessagePort | …`). The host's transfer manifest is
  // typed against the broader DOM `Transferable` union, but the only
  // actual values flowing through today are `ArrayBuffer`s; we cast at
  // the boundary rather than cross-typing the whole engine-core surface
  // to a Node-specific list.
  const host = new WorkerHost(runtime, (pack: WirePack<WorkerResponse>) => {
    port.postMessage(pack.payload, pack.transfer as readonly ArrayBuffer[]);
  });

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
