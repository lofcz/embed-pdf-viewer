import type { PdfRuntimeModule } from '@embedpdf/pdf-runtime';
import {
  EMPTY_TRANSFER,
  EngineError,
  EngineErrorCode,
  serializeError,
  wirePack,
  type AnnotationsCreateWorkerRequest,
  type AnnotationsDeleteWorkerRequest,
  type DocumentCheckPasswordPermissionsWorkerRequest,
  type DocumentProbeSecurityFileWorkerRequest,
  type DocumentSaveBufferWorkerRequest,
  type DocumentSaveFileWorkerRequest,
  type AnnotationsListFullPageWorkerRequest,
  type AnnotationsListRawAllWorkerRequest,
  type AnnotationsListRawPageWorkerRequest,
  type AnnotationsMoveWorkerRequest,
  type AnnotationsUpdateWorkerRequest,
  type CloseWorkerRequest,
  type MetadataReadWorkerRequest,
  type OpenWorkerRequest,
  type PagesListWorkerRequest,
  type PagesGeometryWorkerRequest,
  type PagesMoveWorkerRequest,
  type PagesRenderWorkerRequest,
  type PagesTextWorkerRequest,
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
import { PageTextReader } from '../readers/text/PageTextReader';
import { PageGeometryReader } from '../readers/geometry/PageGeometryReader';
import { PageRasterReader } from '../readers/render/PageRasterReader';
import { DocumentSecurityReader } from '../readers/security/DocumentSecurityReader';
import { DocumentAnnotationMutator } from '../mutation/DocumentAnnotationMutator';
import { DocumentPagesMutator } from '../pages/DocumentPagesMutator';
import { BaseDocumentRegistry } from '../session/BaseDocumentRegistry';
import { openFatMemoryDocument, openLayerDocument } from '../session/PdfDocumentOpener';

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
  private readonly baseDocuments: BaseDocumentRegistry;
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
    this.baseDocuments = new BaseDocumentRegistry(this.runtime);
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
        case 'open.fatMem':
        case 'open.layerMemBase':
        case 'open.layerFileBase':
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
        case 'pages.text':
          resultPack = this.handlePagesText(msg, ctrl.signal);
          break;
        case 'pages.geometry':
          resultPack = this.handlePagesGeometry(msg, ctrl.signal);
          break;
        case 'pages.render':
          resultPack = this.handlePagesRender(msg, ctrl.signal);
          break;
        case 'document.saveBuffer':
          resultPack = this.handleDocumentSaveBuffer(msg);
          break;
        case 'document.saveFile':
          resultPack = this.handleDocumentSaveFile(msg);
          break;
        case 'document.probeSecurityFile':
          resultPack = this.handleDocumentProbeSecurityFile(msg);
          break;
        case 'document.checkPasswordPermissions':
          resultPack = this.handleDocumentCheckPasswordPermissions(msg);
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
    const key = sessionKey(req.docId, req.kind === 'open.fatMem' ? undefined : req.layerName);
    if (this.sessions.has(key)) {
      throw new EngineError(EngineErrorCode.InvalidArg, `document session already open: ${key}`);
    }
    const session = new DocumentSession(this.runtime);
    if (req.kind === 'open.fatMem') {
      session.openFromHandle(
        openFatMemoryDocument(this.runtime, new Uint8Array(req.bytes), req.password),
      );
    } else if (req.kind === 'open.layerMemBase') {
      const base = this.baseDocuments.acquireMemoryBase({
        key: req.baseKey,
        bytes: new Uint8Array(req.baseBytes),
        password: req.password,
      });
      session.openFromHandle(openLayerDocument(this.runtime, base, req.layer, req.password));
    } else {
      const base = this.baseDocuments.acquireFileBase({
        key: req.baseKey,
        path: req.basePath,
        password: req.password,
      });
      session.openFromHandle(openLayerDocument(this.runtime, base, req.layer, req.password));
    }
    this.sessions.set(key, session);
    return wirePack({
      tag: 'open',
      docId: req.docId,
      security: session.checkPasswordPermissions(req.password ?? ''),
    });
  }

  private handleMetadataRead(
    req: MetadataReadWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const metadata = session.metadata().read(signal);
    return wirePack({ tag: 'metadata.read', metadata });
  }

  private handleAnnotationsListRawAll(
    req: AnnotationsListRawAllWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const reader = new RawAnnotationReader(this.runtime, session);
    const snapshot = reader.listAll(signal);
    return wirePack({ tag: 'annotations.listRawAll', snapshot });
  }

  private handleAnnotationsListRawPage(
    req: AnnotationsListRawPageWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const reader = new RawAnnotationReader(this.runtime, session);
    const snapshot = reader.listOne(req.pageObjectNumber, signal);
    return wirePack({ tag: 'annotations.listRawPage', snapshot });
  }

  private handleAnnotationsListFullPage(
    req: AnnotationsListFullPageWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const reader = new FullAnnotationReader(this.runtime, session);
    const snapshot = reader.list(req.pageObjectNumber, signal);
    return wirePack({ tag: 'annotations.listFullPage', snapshot });
  }

  private handleAnnotationsCreate(
    req: AnnotationsCreateWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const mutator = new DocumentAnnotationMutator(this.runtime, session);
    const result = mutator.create(req.pageObjectNumber, req.draft, signal, req.actor);
    if (session.kind !== 'layer') {
      return wirePack({ tag: 'annotations.create', result });
    }
    const saved = this.saveLayerArtifact(session, req.artifactPath);
    return wirePack({ tag: 'annotations.create', result, ...saved.payload }, saved.transfer);
  }

  private handleAnnotationsUpdate(
    req: AnnotationsUpdateWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const mutator = new DocumentAnnotationMutator(this.runtime, session);
    const result = mutator.update(req.ref, req.patch, signal, req.actor);
    if (session.kind !== 'layer') {
      return wirePack({ tag: 'annotations.update', result });
    }
    const saved = this.saveLayerArtifact(session, req.artifactPath);
    return wirePack({ tag: 'annotations.update', result, ...saved.payload }, saved.transfer);
  }

  private handleAnnotationsDelete(
    req: AnnotationsDeleteWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const mutator = new DocumentAnnotationMutator(this.runtime, session);
    const result = mutator.delete(req.ref, signal);
    if (session.kind !== 'layer') {
      return wirePack({ tag: 'annotations.delete', result });
    }
    const saved = this.saveLayerArtifact(session, req.artifactPath);
    return wirePack({ tag: 'annotations.delete', result, ...saved.payload }, saved.transfer);
  }

  private handleAnnotationsMove(
    req: AnnotationsMoveWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const mutator = new DocumentAnnotationMutator(this.runtime, session);
    const result = mutator.move(req.pageObjectNumber, req.refs, req.toIndex, signal);
    if (session.kind !== 'layer') {
      return wirePack({ tag: 'annotations.move', result });
    }
    const saved = this.saveLayerArtifact(session, req.artifactPath);
    return wirePack({ tag: 'annotations.move', result, ...saved.payload }, saved.transfer);
  }

  private handlePagesList(
    req: PagesListWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const mutator = new DocumentPagesMutator(this.runtime, session);
    const snapshot = mutator.list(signal);
    return wirePack({ tag: 'pages.list', snapshot });
  }

  private handlePagesMove(
    req: PagesMoveWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const mutator = new DocumentPagesMutator(this.runtime, session);
    const result = mutator.move(req.pageObjectNumbers, req.destIndex, signal);
    if (session.kind !== 'layer') {
      return wirePack({ tag: 'pages.move', result });
    }
    const saved = this.saveLayerArtifact(session, req.artifactPath);
    return wirePack({ tag: 'pages.move', result, ...saved.payload }, saved.transfer);
  }

  private handlePagesText(
    req: PagesTextWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const reader = new PageTextReader(this.runtime, session);
    const snapshot = reader.read(req.pageObjectNumber, signal);
    return wirePack({ tag: 'pages.text', snapshot });
  }

  private handlePagesGeometry(
    req: PagesGeometryWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const reader = new PageGeometryReader(this.runtime, session);
    const snapshot = reader.read(req.pageObjectNumber, signal);
    return wirePack({ tag: 'pages.geometry', snapshot });
  }

  private handlePagesRender(
    req: PagesRenderWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const reader = new PageRasterReader(this.runtime, session);
    const raster = reader.render(req.pageObjectNumber, req.options ?? {}, signal);
    return wirePack({ tag: 'pages.render', raster }, [raster.data]);
  }

  private handleDocumentSaveBuffer(
    req: DocumentSaveBufferWorkerRequest,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const saved = session.saveStandaloneToBuffer(req.mode);
    return wirePack({ tag: 'document.saveBuffer', bytes: saved.bytes, size: saved.size }, [
      saved.bytes,
    ]);
  }

  private handleDocumentSaveFile(
    req: DocumentSaveFileWorkerRequest,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const saved = session.saveStandaloneToFile(req.path, req.mode);
    return wirePack({ tag: 'document.saveFile', path: saved.path });
  }

  private handleDocumentProbeSecurityFile(
    req: DocumentProbeSecurityFileWorkerRequest,
  ): WirePack<WorkerResultPayload> {
    const reader = new DocumentSecurityReader(this.runtime);
    const security = reader.probeFile(req.path, req.password);
    return wirePack({ tag: 'document.probeSecurityFile', security });
  }

  private handleDocumentCheckPasswordPermissions(
    req: DocumentCheckPasswordPermissionsWorkerRequest,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const security = session.checkPasswordPermissions(req.password, req.mode ?? 'any');
    return wirePack({ tag: 'document.checkPasswordPermissions', security });
  }

  private handleClose(req: CloseWorkerRequest): WirePack<WorkerResultPayload> {
    for (const [key, session] of Array.from(this.sessions.entries())) {
      if (!sessionKeyBelongsToDoc(key, req.docId)) continue;
      session.close();
      this.sessions.delete(key);
    }
    return wirePack({ tag: 'close' });
  }

  private handleShutdown(_req: ShutdownWorkerRequest): WirePack<WorkerResultPayload> {
    if (!this.destroyed) {
      this.destroyed = true;
      for (const session of this.sessions.values()) session.close();
      this.sessions.clear();
      this.baseDocuments.releaseAll();
      destroyLibrary(this.runtime);
    }
    return wirePack({ tag: 'shutdown' });
  }

  private requireSession(req: { docId: string; layerName?: string }): DocumentSession {
    const key = sessionKey(req.docId, req.layerName);
    const session = this.sessions.get(key);
    if (!session || !session.isOpen()) {
      throw new EngineError(EngineErrorCode.DocNotOpen, `document session not open: ${key}`);
    }
    return session;
  }

  private saveLayerArtifact(
    session: DocumentSession,
    artifactPath?: string,
  ): {
    payload:
      | { artifact: { bytes: ArrayBuffer; size: number } }
      | { artifactFile: { path: string } };
    transfer: ArrayBuffer[];
  } {
    if (artifactPath) {
      const artifactFile = session.saveLayerArtifactToFile(artifactPath);
      return { payload: { artifactFile }, transfer: [] };
    }
    const artifact = session.saveLayerArtifact();
    return { payload: { artifact }, transfer: [artifact.bytes] };
  }
}

const BASE_SESSION_SUFFIX = '__base__';

function sessionKey(docId: string, layerName?: string): string {
  return `${docId}::${layerName ? `layer:${layerName}` : BASE_SESSION_SUFFIX}`;
}

function sessionKeyBelongsToDoc(key: string, docId: string): boolean {
  return key === sessionKey(docId) || key.startsWith(`${docId}::layer:`);
}
