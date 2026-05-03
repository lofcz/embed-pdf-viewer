import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  type DocumentHandle,
  type Engine,
  type OpenInput,
  type OpenOptions,
} from '@embedpdf/engine-core';
import type { Transport } from './transport/Transport';
import { WorkerQueue } from './worker/WorkerQueue';
import { Priority } from './worker/Priority';
import type { JobId, WorkerResultPayload } from './worker/protocol';
import { LocalDocumentHandle } from './document/LocalDocumentHandle';

export interface LocalEngineOptions {
  transport: Transport;
  concurrency?: number;
}

/**
 * Local engine: speaks the same Engine interface as @embedpdf/engine-cloud
 * but routes everything through a WorkerQueue + Transport (Web Worker or
 * inline) backed by a WASM PDFium runtime.
 */
export class LocalEngine implements Engine {
  static fromTransport(opts: LocalEngineOptions): LocalEngine {
    return new LocalEngine(opts.transport, opts.concurrency ?? 1);
  }

  private readonly queue: WorkerQueue;
  private destroyed = false;

  private constructor(transport: Transport, concurrency: number) {
    this.queue = new WorkerQueue(transport, { concurrency });
  }

  open(input: OpenInput, options?: OpenOptions): AbortablePromise<DocumentHandle> {
    if (this.destroyed) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.RuntimeUnavailable, 'engine destroyed'),
      );
    }
    if (input.kind !== 'bytes') {
      return AbortablePromise.rejectReason(
        new EngineError(
          EngineErrorCode.InvalidArg,
          `local engine only supports OpenInput.kind === 'bytes' (got '${input.kind}')`,
        ),
      );
    }

    const queue = this.queue;
    const password = options?.password ?? input.password ?? null;
    const buffer = toArrayBuffer(input.bytes);
    const docId = input.id;

    const submission = queue.enqueue<WorkerResultPayload>(
      {
        buildRequest: (jobId: JobId) => ({
          kind: 'open',
          jobId,
          docId,
          bytes: buffer,
          password,
        }),
        transferables: [buffer],
      },
      { priority: Priority.HIGH },
    );

    return AbortablePromise.run<DocumentHandle>(async (signal) => {
      const onAbort = () => submission.abort(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });

      const payload = await submission;
      if (payload.tag !== 'open') {
        throw new EngineError(EngineErrorCode.WireFormat, `unexpected payload tag: ${payload.tag}`);
      }
      return new LocalDocumentHandle(payload.docId, queue);
    });
  }

  destroy(): AbortablePromise<void> {
    if (this.destroyed) {
      return AbortablePromise.resolveValue<void>(undefined);
    }
    this.destroyed = true;
    return AbortablePromise.run<void>(async () => {
      await this.queue.shutdown();
    });
  }
}

function toArrayBuffer(input: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  // Copy to a fresh ArrayBuffer so we can transfer it without disturbing
  // an unrelated SharedArrayBuffer or larger view the caller still owns.
  const copy = new ArrayBuffer(input.byteLength);
  new Uint8Array(copy).set(input);
  return copy;
}
