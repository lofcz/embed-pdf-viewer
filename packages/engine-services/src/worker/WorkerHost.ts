import type { PdfRuntimeModule } from '@embedpdf/pdf-runtime';
import {
  EngineError,
  EngineErrorCode,
  serializeError,
  type AnnotationsListFullPageWorkerRequest,
  type AnnotationsListRawAllWorkerRequest,
  type AnnotationsListRawPageWorkerRequest,
  type CloseWorkerRequest,
  type MetadataReadWorkerRequest,
  type OpenWorkerRequest,
  type SerializedEngineError,
  type ShutdownWorkerRequest,
  type WorkerJobId,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerResultPayload,
} from '@embedpdf/engine-core';
import { DocumentSession } from '../session/DocumentSession';
import { ensureInitialized, destroyLibrary } from '../runtime-bootstrap';
import { RawAnnotationReader } from '../readers/annotations/RawAnnotationReader';
import { FullAnnotationReader } from '../readers/annotations/FullAnnotationReader';

/**
 * The piece that runs "inside the worker": owns runtime, manages document
 * sessions, dispatches requests to the engine-services synchronous code.
 *
 * Environment-agnostic. Wrap it with a Web Worker entry, a Node
 * worker_thread entry, or an inline transport. The wrapper owns
 * postMessage plumbing and any process/lifecycle concerns; the host only
 * knows about PdfRuntimeModule, DocumentSession, AbortController, and the
 * worker wire shape from @embedpdf/engine-core.
 */
export class WorkerHost {
  private readonly sessions = new Map<string, DocumentSession>();
  private readonly aborts = new Map<WorkerJobId, AbortController>();
  private destroyed = false;

  constructor(
    private readonly runtime: PdfRuntimeModule,
    private readonly post: (msg: WorkerResponse) => void,
  ) {
    ensureInitialized(this.runtime);
  }

  receive(msg: WorkerRequest): void {
    if (msg.kind === 'abort') {
      this.aborts.get(msg.jobId)?.abort();
      return;
    }

    const ctrl = new AbortController();
    this.aborts.set(msg.jobId, ctrl);

    let result: WorkerResultPayload;
    try {
      switch (msg.kind) {
        case 'open':
          result = this.handleOpen(msg, ctrl.signal);
          break;
        case 'metadata.read':
          result = this.handleMetadataRead(msg, ctrl.signal);
          break;
        case 'annotations.listRawAll':
          result = this.handleAnnotationsListRawAll(msg, ctrl.signal);
          break;
        case 'annotations.listRawPage':
          result = this.handleAnnotationsListRawPage(msg, ctrl.signal);
          break;
        case 'annotations.listFullPage':
          result = this.handleAnnotationsListFullPage(msg, ctrl.signal);
          break;
        case 'close':
          result = this.handleClose(msg);
          break;
        case 'shutdown':
          result = this.handleShutdown(msg);
          break;
        default:
          throw new EngineError(
            EngineErrorCode.InvalidArg,
            `unknown request kind: ${(msg as WorkerRequest).kind}`,
          );
      }
      this.post({ kind: 'resolve', jobId: msg.jobId, result });
    } catch (err) {
      const error: SerializedEngineError = serializeError(err);
      this.post({ kind: 'reject', jobId: msg.jobId, error });
    } finally {
      this.aborts.delete(msg.jobId);
    }
  }

  private handleOpen(req: OpenWorkerRequest, _signal: AbortSignal): WorkerResultPayload {
    if (this.sessions.has(req.docId)) {
      throw new EngineError(EngineErrorCode.InvalidArg, `document already open: ${req.docId}`);
    }
    const session = new DocumentSession(this.runtime);
    session.open(new Uint8Array(req.bytes), req.password);
    this.sessions.set(req.docId, session);
    return { tag: 'open', docId: req.docId };
  }

  private handleMetadataRead(
    req: MetadataReadWorkerRequest,
    signal: AbortSignal,
  ): WorkerResultPayload {
    const session = this.requireSession(req.docId);
    const metadata = session.metadata().read(signal);
    return { tag: 'metadata.read', metadata };
  }

  private handleAnnotationsListRawAll(
    req: AnnotationsListRawAllWorkerRequest,
    signal: AbortSignal,
  ): WorkerResultPayload {
    const session = this.requireSession(req.docId);
    const reader = new RawAnnotationReader(this.runtime, session);
    const snapshot = reader.listAll(signal);
    return { tag: 'annotations.listRawAll', snapshot };
  }

  private handleAnnotationsListRawPage(
    req: AnnotationsListRawPageWorkerRequest,
    signal: AbortSignal,
  ): WorkerResultPayload {
    const session = this.requireSession(req.docId);
    const reader = new RawAnnotationReader(this.runtime, session);
    const snapshot = reader.listOne(req.pageObjectNumber, signal);
    return { tag: 'annotations.listRawPage', snapshot };
  }

  private handleAnnotationsListFullPage(
    req: AnnotationsListFullPageWorkerRequest,
    signal: AbortSignal,
  ): WorkerResultPayload {
    const session = this.requireSession(req.docId);
    const reader = new FullAnnotationReader(this.runtime, session);
    const snapshot = reader.list(req.pageObjectNumber, signal);
    return { tag: 'annotations.listFullPage', snapshot };
  }

  private handleClose(req: CloseWorkerRequest): WorkerResultPayload {
    const session = this.sessions.get(req.docId);
    if (session) {
      session.close();
      this.sessions.delete(req.docId);
    }
    return { tag: 'close' };
  }

  private handleShutdown(_req: ShutdownWorkerRequest): WorkerResultPayload {
    if (!this.destroyed) {
      this.destroyed = true;
      for (const session of this.sessions.values()) session.close();
      this.sessions.clear();
      destroyLibrary(this.runtime);
    }
    return { tag: 'shutdown' };
  }

  private requireSession(docId: string): DocumentSession {
    const session = this.sessions.get(docId);
    if (!session || !session.isOpen()) {
      throw new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${docId}`);
    }
    return session;
  }
}
