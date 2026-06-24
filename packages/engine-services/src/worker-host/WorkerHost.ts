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
  type DocumentSaveLayerBufferWorkerRequest,
  type FontsRegisterWorkerRequest,
  type FontsAddFallbackWorkerRequest,
  type FontsClearFallbacksWorkerRequest,
  type FontsClearWorkerRequest,
  type AnnotationsListFullPageWorkerRequest,
  type AnnotationsListRawAllWorkerRequest,
  type AnnotationsListRawPageWorkerRequest,
  type AnnotationsRenderAppearancesWorkerRequest,
  type AnnotationsMoveWorkerRequest,
  type AnnotationsUpdateWorkerRequest,
  type CloseWorkerRequest,
  type MetadataReadWorkerRequest,
  type MetadataUpdateWorkerRequest,
  type OpenWorkerRequest,
  type PagesListWorkerRequest,
  type PagesGeometryWorkerRequest,
  type PagesMoveWorkerRequest,
  type PagesRotateWorkerRequest,
  type PagesDeleteWorkerRequest,
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
import type { PdfRuntimeModule } from '@embedpdf/pdf-runtime';

import { DocumentSession } from '../document-session/DocumentSession';
import { BaseDocumentRegistry } from '../document-session/lifecycle/BaseDocumentRegistry';
import {
  openFatMemoryDocument,
  openLayerDocument,
} from '../document-session/lifecycle/PdfDocumentOpener';
import {
  AnnotationReader,
  AnnotationAppearanceReader,
  AnnotationMutator,
  RawAnnotationReader,
} from '../features/annotations';
import { FontRegistrar, type StartupFontSpec } from '../features/fonts';
import { PageGeometryReader } from '../features/geometry';
import { MetadataMutator, MetadataReader } from '../features/metadata';
import { PagesMutator, PagesReader } from '../features/pages';
import { PageRenderReader } from '../features/render';
import { DocumentSaver } from '../features/save';
import { SecurityReader } from '../features/security';
import { PageTextReader } from '../features/text';
import { ensureInitialized, destroyLibrary } from '../runtime/lifecycle/bootstrap';

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
  /**
   * Runtime-global registered fonts for this thread. The registry is
   * thread-local in PDFium, so it lives on the host (one per thread), not per
   * document session. `fontIds` maps the stable wire `fontKey` to this
   * thread's volatile native FontId.
   */
  private readonly fontIds = new Map<string, number>();
  private readonly fonts: FontRegistrar;
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
    this.fonts = new FontRegistrar(this.runtime, this.fontIds);
  }

  /**
   * Register deployment-owned fonts on this worker thread, after init and
   * before serving requests. Server-only: the cloud engine never exposes font
   * configuration to clients, so the host (not a wire message) seeds the
   * thread's fallback fonts. Browser engines drive fonts through the
   * `fonts.*` wire path instead. Throws if any font fails to load.
   */
  registerStartupFonts(specs: readonly StartupFontSpec[]): void {
    this.fonts.registerStartup(specs);
  }

  receive(msg: WorkerRequest): void {
    if (msg.kind === 'abort') {
      this.aborts.get(msg.jobId)?.abort();
      return;
    }

    const ctrl = new AbortController();
    this.aborts.set(msg.jobId, ctrl);

    // Abort policy: only handlers that loop over pages/annotations honor
    // `ctrl.signal` (the read/mutation paths below). One-shot native
    // operations — open, document save, security probe, close, shutdown —
    // are effectively atomic from our side and intentionally non-abortable,
    // so they do not receive the signal.
    let resultPack: WirePack<WorkerResultPayload>;
    try {
      switch (msg.kind) {
        case 'open.fatMem':
        case 'open.layerMemBase':
        case 'open.layerFileBase':
          resultPack = this.handleOpen(msg);
          break;
        case 'metadata.read':
          resultPack = this.handleMetadataRead(msg, ctrl.signal);
          break;
        case 'metadata.update':
          resultPack = this.handleMetadataUpdate(msg, ctrl.signal);
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
        case 'annotations.renderAppearances':
          resultPack = this.handleAnnotationsRenderAppearances(msg, ctrl.signal);
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
        case 'pages.rotate':
          resultPack = this.handlePagesRotate(msg, ctrl.signal);
          break;
        case 'pages.delete':
          resultPack = this.handlePagesDelete(msg, ctrl.signal);
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
        case 'document.saveLayerBuffer':
          resultPack = this.handleDocumentSaveLayerBuffer(msg);
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
        case 'fonts.register':
          resultPack = this.handleFontsRegister(msg);
          break;
        case 'fonts.addFallback':
          resultPack = this.handleFontsAddFallback(msg);
          break;
        case 'fonts.clearFallbacks':
          resultPack = this.handleFontsClearFallbacks(msg);
          break;
        case 'fonts.clear':
          resultPack = this.handleFontsClear(msg);
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

  private handleOpen(req: OpenWorkerRequest): WirePack<WorkerResultPayload> {
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
      security: new SecurityReader(this.runtime).checkPasswordPermissions(
        session,
        req.password ?? '',
      ),
    });
  }

  private handleMetadataRead(
    req: MetadataReadWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const metadata = new MetadataReader(this.runtime, session).read(signal);
    return wirePack({ tag: 'metadata.read', metadata });
  }

  private handleMetadataUpdate(
    req: MetadataUpdateWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const mutator = new MetadataMutator(this.runtime, session);
    const result = mutator.update(req.patch, signal);
    return this.finishMutation(session, { tag: 'metadata.update', result }, req.artifactPath);
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
    const reader = new AnnotationReader(this.runtime, session);
    const snapshot = reader.list(req.pageObjectNumber, signal);
    return wirePack({ tag: 'annotations.listFullPage', snapshot });
  }

  private handleAnnotationsRenderAppearances(
    req: AnnotationsRenderAppearancesWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const reader = new AnnotationAppearanceReader(this.runtime, session);
    const result = reader.render(req.pageObjectNumber, req.options ?? {}, signal);
    // Transfer every appearance raster buffer back zero-copy, like pages.render.
    const transfer = result.appearances.map((a) => a.raster.data);
    return wirePack({ tag: 'annotations.renderAppearances', result }, transfer);
  }

  private handleAnnotationsCreate(
    req: AnnotationsCreateWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const mutator = new AnnotationMutator(this.runtime, session, this.fonts);
    const result = mutator.create(req.pageObjectNumber, req.draft, signal, req.actor);
    return this.finishMutation(session, { tag: 'annotations.create', result }, req.artifactPath);
  }

  private handleAnnotationsUpdate(
    req: AnnotationsUpdateWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const mutator = new AnnotationMutator(this.runtime, session, this.fonts);
    const result = mutator.update(req.ref, req.patch, signal, req.actor);
    return this.finishMutation(session, { tag: 'annotations.update', result }, req.artifactPath);
  }

  private handleAnnotationsDelete(
    req: AnnotationsDeleteWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const mutator = new AnnotationMutator(this.runtime, session);
    const result = mutator.delete(req.ref, signal);
    return this.finishMutation(session, { tag: 'annotations.delete', result }, req.artifactPath);
  }

  private handleAnnotationsMove(
    req: AnnotationsMoveWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const mutator = new AnnotationMutator(this.runtime, session);
    const result = mutator.move(req.pageObjectNumber, req.refs, req.toIndex, signal);
    return this.finishMutation(session, { tag: 'annotations.move', result }, req.artifactPath);
  }

  private handlePagesList(
    req: PagesListWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const reader = new PagesReader(this.runtime, session);
    const snapshot = reader.read(signal);
    return wirePack({ tag: 'pages.list', snapshot });
  }

  private handlePagesMove(
    req: PagesMoveWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const mutator = new PagesMutator(this.runtime, session);
    const result = mutator.move(req.pageObjectNumbers, req.destIndex, signal);
    return this.finishMutation(session, { tag: 'pages.move', result }, req.artifactPath);
  }

  private handlePagesRotate(
    req: PagesRotateWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const mutator = new PagesMutator(this.runtime, session);
    const result = mutator.rotate(req.pageObjectNumbers, req.rotation, signal);
    return this.finishMutation(session, { tag: 'pages.rotate', result }, req.artifactPath);
  }

  private handlePagesDelete(
    req: PagesDeleteWorkerRequest,
    signal: AbortSignal,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const mutator = new PagesMutator(this.runtime, session);
    const result = mutator.delete(req.pageObjectNumbers, signal);
    return this.finishMutation(session, { tag: 'pages.delete', result }, req.artifactPath);
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
    const reader = new PageRenderReader(this.runtime, session);
    const raster = reader.render(req.pageObjectNumber, req.options ?? {}, signal);
    return wirePack({ tag: 'pages.render', raster }, [raster.data]);
  }

  private handleDocumentSaveBuffer(
    req: DocumentSaveBufferWorkerRequest,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const saved = new DocumentSaver(this.runtime, session).saveStandaloneToBuffer(req.mode);
    return wirePack({ tag: 'document.saveBuffer', bytes: saved.bytes, size: saved.size }, [
      saved.bytes,
    ]);
  }

  private handleDocumentSaveFile(
    req: DocumentSaveFileWorkerRequest,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const saved = new DocumentSaver(this.runtime, session).saveStandaloneToFile(req.path, req.mode);
    return wirePack({ tag: 'document.saveFile', path: saved.path });
  }

  private handleDocumentSaveLayerBuffer(
    req: DocumentSaveLayerBufferWorkerRequest,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    if (session.kind !== 'layer') {
      throw new EngineError(
        EngineErrorCode.InvalidArg,
        'document has no layer to export (opened without a layer)',
      );
    }
    const artifact = new DocumentSaver(this.runtime, session).saveLayerArtifact();
    return wirePack(
      { tag: 'document.saveLayerBuffer', bytes: artifact.bytes, size: artifact.size },
      [artifact.bytes],
    );
  }

  private handleDocumentProbeSecurityFile(
    req: DocumentProbeSecurityFileWorkerRequest,
  ): WirePack<WorkerResultPayload> {
    const reader = new SecurityReader(this.runtime);
    const security = reader.probeFile(req.path, req.password);
    return wirePack({ tag: 'document.probeSecurityFile', security });
  }

  private handleDocumentCheckPasswordPermissions(
    req: DocumentCheckPasswordPermissionsWorkerRequest,
  ): WirePack<WorkerResultPayload> {
    const session = this.requireSession(req);
    const security = new SecurityReader(this.runtime).checkPasswordPermissions(
      session,
      req.password,
      req.mode ?? 'any',
    );
    return wirePack({ tag: 'document.checkPasswordPermissions', security });
  }

  private handleFontsRegister(req: FontsRegisterWorkerRequest): WirePack<WorkerResultPayload> {
    this.fonts.register(
      req.fontKey,
      req.familyName,
      req.weight,
      req.italic,
      new Uint8Array(req.data),
    );
    return wirePack({ tag: 'fonts.register', fontKey: req.fontKey });
  }

  private handleFontsAddFallback(
    req: FontsAddFallbackWorkerRequest,
  ): WirePack<WorkerResultPayload> {
    this.fonts.addFallback(req.fontKey);
    return wirePack({ tag: 'fonts.addFallback' });
  }

  private handleFontsClearFallbacks(
    _req: FontsClearFallbacksWorkerRequest,
  ): WirePack<WorkerResultPayload> {
    this.fonts.clearFallbacks();
    return wirePack({ tag: 'fonts.clearFallbacks' });
  }

  private handleFontsClear(_req: FontsClearWorkerRequest): WirePack<WorkerResultPayload> {
    this.fonts.clear();
    return wirePack({ tag: 'fonts.clear' });
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

  /**
   * Finalize a mutation response. For a standalone session the mutation
   * result is returned as-is. For a layer session we additionally persist
   * the layer artifact (to file when `artifactPath` is given, otherwise to
   * a transferable buffer) and merge it onto the response envelope. This
   * is the one place the layer-vs-standalone branch lives, shared by every
   * annotation and page mutation handler.
   */
  private finishMutation<P extends WorkerResultPayload>(
    session: DocumentSession,
    payload: P,
    artifactPath?: string,
  ): WirePack<WorkerResultPayload> {
    if (session.kind !== 'layer') {
      return wirePack(payload);
    }
    const saved = this.saveLayerArtifact(session, artifactPath);
    return wirePack({ ...payload, ...saved.payload }, saved.transfer);
  }

  private saveLayerArtifact(session: DocumentSession, artifactPath?: string): LayerArtifactSave {
    const saver = new DocumentSaver(this.runtime, session);
    if (artifactPath) {
      const artifactFile = saver.saveLayerArtifactToFile(artifactPath);
      return { payload: { artifactFile }, transfer: [] };
    }
    const artifact = saver.saveLayerArtifact();
    return { payload: { artifact }, transfer: [artifact.bytes] };
  }
}

interface LayerArtifactSave {
  payload: { artifact: { bytes: ArrayBuffer; size: number } } | { artifactFile: { path: string } };
  transfer: ArrayBuffer[];
}

const BASE_SESSION_SUFFIX = '__base__';

function sessionKey(docId: string, layerName?: string): string {
  return `${docId}::${layerName ? `layer:${layerName}` : BASE_SESSION_SUFFIX}`;
}

function sessionKeyBelongsToDoc(key: string, docId: string): boolean {
  return key === sessionKey(docId) || key.startsWith(`${docId}::layer:`);
}
