import type { PdfRuntimeModule } from '@embedpdf/pdf-runtime';
import {
  EMPTY_TRANSFER,
  EngineError,
  EngineErrorCode,
  serializeError,
  wirePack,
  type AnnotationsCreateWorkerRequest,
  type AnnotationsDeleteWorkerRequest,
  type AnnotationsListFullPageWorkerRequest,
  type AnnotationsListRawAllWorkerRequest,
  type AnnotationsListRawPageWorkerRequest,
  type AnnotationsMoveWorkerRequest,
  type AnnotationsUpdateWorkerRequest,
  type CloseWorkerRequest,
  type MetadataReadWorkerRequest,
  type OpenWorkerRequest,
  type PagesListWorkerRequest,
  type PagesMoveWorkerRequest,
  type SerializedEngineError,
  type ShutdownWorkerRequest,
  type WirePack,
  type WorkerJobId,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerResultPayload,
} from '@embedpdf/engine-core/runtime';
import { DocumentSession } from '../session/DocumentSession';
import { ensureInitialized, destroyLibrary } from '../runtime-bootstrap';
import { RawAnnotationReader } from '../readers/annotations/RawAnnotationReader';
import { FullAnnotationReader } from '../readers/annotations/FullAnnotationReader';
import { DocumentAnnotationMutator } from '../mutation/DocumentAnnotationMutator';
import { DocumentPagesMutator } from '../pages/DocumentPagesMutator';

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
    /**
     * Receives a fully-typed `WirePack<WorkerResponse>` (the envelope
     * payload plus its transfer manifest). The wrapper (browser
     * `worker-entry.ts`, Node `worker-entry.ts`, or `InlineTransport`)
     * is responsible for actually invoking `postMessage(pack.payload,
     * pack.transfer)` — the host doesn't know which environment it
     * runs in.
     */
    private readonly post: (pack: WirePack<WorkerResponse>) => void,
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

    let resultPack: WirePack<WorkerResultPayload>;
    try {
      switch (msg.kind) {
        case 'open':
          resultPack = this.handleOpen(msg, ctrl.signal);
          break;
        case 'metadata.read':
          resultPack = this.handleMetadataRead(msg, ctrl.signal);
          break;
        case 'annotations.listRawAll':
          resultPack = this.handleAnnotationsListRawAll(msg, ctrl.signal);
          break;
        case 'annotations.listRawPage':
          resultPack = this.handleAnnotationsListRawPage(msg, ctrl.signal);
          break;
        case 'annotations.listFullPage':
          resultPack = this.handleAnnotationsListFullPage(msg, ctrl.signal);
          break;
        case 'annotations.create':
          resultPack = this.handleAnnotationsCreate(msg, ctrl.signal);
          break;
        case 'annotations.update':
          resultPack = this.handleAnnotationsUpdate(msg, ctrl.signal);
          break;
        case 'annotations.delete':
          resultPack = this.handleAnnotationsDelete(msg, ctrl.signal);
          break;
        case 'annotations.move':
          resultPack = this.handleAnnotationsMove(msg, ctrl.signal);
          break;
        case 'pages.list':
          resultPack = this.handlePagesList(msg, ctrl.signal);
          break;
        case 'pages.move':
          resultPack = this.handlePagesMove(msg, ctrl.signal);
          break;
        case 'close':
          resultPack = this.handleClose(msg);
          break;
        case 'shutdown':
          resultPack = this.handleShutdown(msg);
          break;
        default:
          throw new EngineError(
            EngineErrorCode.InvalidArg,
            `unknown request kind: ${(msg as WorkerRequest).kind}`,
          );
      }
      // Lift the handler's transfer manifest onto the response envelope
      // unchanged. The handler decided which buffers to move; the host
      // just relays that decision through the `resolve` envelope.
      this.post(
        wirePack(
          { kind: 'resolve', jobId: msg.jobId, result: resultPack.payload },
          resultPack.transfer,
        ),
      );
    } catch (err) {
      const error: SerializedEngineError = serializeError(err);
      // Reject envelopes never carry binary; explicit EMPTY_TRANSFER
      // documents that intent.
      this.post(wirePack({ kind: 'reject', jobId: msg.jobId, error }, EMPTY_TRANSFER));
    } finally {
      this.aborts.delete(msg.jobId);
    }
  }

  private handleOpen(req: OpenWorkerRequest, _signal: AbortSignal): WirePack<WorkerResultPayload> {
    if (this.sessions.has(req.docId)) {
      throw new EngineError(EngineErrorCode.InvalidArg, `document already open: ${req.docId}`);
    }
    const session = new DocumentSession(this.runtime);
    session.open(new Uint8Array(req.bytes), req.password);
    this.sessions.set(req.docId, session);
    return wirePack({ tag: 'open', docId: req.docId });
  }

  private handleMetadataRead(
    req: MetadataReadWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req.docId);
    const metadata = session.metadata().read(signal);
    return wirePack({ tag: 'metadata.read', metadata });
  }

  private handleAnnotationsListRawAll(
    req: AnnotationsListRawAllWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req.docId);
    const reader = new RawAnnotationReader(this.runtime, session);
    const snapshot = reader.listAll(signal);
    return wirePack({ tag: 'annotations.listRawAll', snapshot });
  }

  private handleAnnotationsListRawPage(
    req: AnnotationsListRawPageWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req.docId);
    const reader = new RawAnnotationReader(this.runtime, session);
    const snapshot = reader.listOne(req.pageObjectNumber, signal);
    return wirePack({ tag: 'annotations.listRawPage', snapshot });
  }

  private handleAnnotationsListFullPage(
    req: AnnotationsListFullPageWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req.docId);
    const reader = new FullAnnotationReader(this.runtime, session);
    const snapshot = reader.list(req.pageObjectNumber, signal);
    return wirePack({ tag: 'annotations.listFullPage', snapshot });
  }

  private handleAnnotationsCreate(
    req: AnnotationsCreateWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req.docId);
    const mutator = new DocumentAnnotationMutator(this.runtime, session);
    const result = mutator.create(req.pageObjectNumber, req.draft, signal);
    return wirePack({ tag: 'annotations.create', result });
  }

  private handleAnnotationsUpdate(
    req: AnnotationsUpdateWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req.docId);
    const mutator = new DocumentAnnotationMutator(this.runtime, session);
    const result = mutator.update(req.ref, req.patch, signal);
    return wirePack({ tag: 'annotations.update', result });
  }

  private handleAnnotationsDelete(
    req: AnnotationsDeleteWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req.docId);
    const mutator = new DocumentAnnotationMutator(this.runtime, session);
    const result = mutator.delete(req.ref, signal);
    return wirePack({ tag: 'annotations.delete', result });
  }

  private handleAnnotationsMove(
    req: AnnotationsMoveWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req.docId);
    const mutator = new DocumentAnnotationMutator(this.runtime, session);
    const result = mutator.move(req.pageObjectNumber, req.refs, req.toIndex, signal);
    return wirePack({ tag: 'annotations.move', result });
  }

  private handlePagesList(
    req: PagesListWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req.docId);
    const mutator = new DocumentPagesMutator(this.runtime, session);
    const snapshot = mutator.list(signal);
    return wirePack({ tag: 'pages.list', snapshot });
  }

  private handlePagesMove(
    req: PagesMoveWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req.docId);
    const mutator = new DocumentPagesMutator(this.runtime, session);
    const result = mutator.move(req.pageObjectNumbers, req.destIndex, signal);
    return wirePack({ tag: 'pages.move', result });
  }

  private handleClose(req: CloseWorkerRequest): WirePack<WorkerResultPayload> {
    const session = this.sessions.get(req.docId);
    if (session) {
      session.close();
      this.sessions.delete(req.docId);
    }
    return wirePack({ tag: 'close' });
  }

  private handleShutdown(_req: ShutdownWorkerRequest): WirePack<WorkerResultPayload> {
    if (!this.destroyed) {
      this.destroyed = true;
      for (const session of this.sessions.values()) session.close();
      this.sessions.clear();
      destroyLibrary(this.runtime);
    }
    return wirePack({ tag: 'shutdown' });
  }

  private requireSession(docId: string): DocumentSession {
    const session = this.sessions.get(docId);
    if (!session || !session.isOpen()) {
      throw new EngineError(EngineErrorCode.DocNotOpen, `document not open: ${docId}`);
    }
    return session;
  }
}
