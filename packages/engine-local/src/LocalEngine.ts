import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  wirePack,
  type DocumentHandle,
  type Engine,
  type OpenInput,
  type OpenOptions,
} from '@embedpdf/engine-core/runtime';
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

    if (input.kind === 'bytes') {
      return this.openBytes(input, options);
    }

    if (input.kind === 'layerBytes') {
      return this.openLayerBytes(input, options);
    }

    return AbortablePromise.rejectReason(
      new EngineError(
        EngineErrorCode.InvalidArg,
        `local engine only supports OpenInput.kind === 'bytes' or 'layerBytes' (got '${input.kind}')`,
      ),
    );
  }

  private openBytes(
    input: Extract<OpenInput, { kind: 'bytes' }>,
    options?: OpenOptions,
  ): AbortablePromise<DocumentHandle> {
    const queue = this.queue;
    const password = options?.password ?? input.password ?? null;
    const buffer = toArrayBuffer(input.bytes);
    const docId = input.id;

    const submission = queue.enqueue<WorkerResultPayload>(
      {
        // open() is the one current producer that actually carries a buffer.
        // The buffer reference appears once in the payload and once in the
        // transfer manifest — same object, marked for zero-copy move so the
        // sender's `buffer.byteLength` becomes 0 after the transport hands
        // it off to the worker.
        buildPack: (jobId: JobId) =>
          wirePack({ kind: 'open.fatMem', jobId, docId, bytes: buffer, password }, [buffer]),
      },
      { priority: Priority.HIGH },
    );

    return this.openResult(submission);
  }

  private openLayerBytes(
    input: Extract<OpenInput, { kind: 'layerBytes' }>,
    options?: OpenOptions,
  ): AbortablePromise<DocumentHandle> {
    const queue = this.queue;
    const password = options?.password ?? input.password ?? null;
    const docId = input.id;
    const baseKey = input.baseKey ?? input.id;
    const baseBytes = toArrayBuffer(input.baseBytes);
    const artifactBytes =
      input.layer?.kind === 'artifact' ? toArrayBuffer(input.layer.bytes) : undefined;
    const layer =
      artifactBytes === undefined
        ? ({ kind: 'fresh' } as const)
        : ({ kind: 'artifact', bytes: artifactBytes } as const);
    const transfer = artifactBytes ? [baseBytes, artifactBytes] : [baseBytes];

    const submission = queue.enqueue<WorkerResultPayload>(
      {
        buildPack: (jobId: JobId) =>
          wirePack(
            {
              kind: 'open.layerMemBase',
              jobId,
              docId,
              baseKey,
              baseBytes,
              layer,
              password,
            },
            transfer,
          ),
      },
      { priority: Priority.HIGH },
    );

    return this.openResult(submission);
  }

  private openResult(
    submission: AbortablePromise<WorkerResultPayload>,
  ): AbortablePromise<DocumentHandle> {
    const queue = this.queue;
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
