import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Kysely, Transaction } from 'kysely';
import {
  EngineError,
  EngineErrorCode,
  wirePack,
  type AnnotationActor,
  type AnnotationCreateResult,
  type AnnotationDeleteResult,
  type AnnotationDraft,
  type AnnotationMoveResult,
  type AnnotationPatch,
  type AnnotationRef,
  type AnnotationUpdateResult,
  type IdentityClaims,
  type MetadataPatch,
  type MetadataUpdateResult,
  type PageDeleteResult,
  type PageListSnapshot,
  type PageMoveResult,
  type PageObjectNumber,
  type PageRotateResult,
  type PageRotation,
  type PageState,
  type PageStructureCache,
  type WorkerJobId,
} from '@embedpdf/engine-core/runtime';
import type { Database as Schema } from '../db/schema';
import type { DocumentsRepo } from '../db/repos/documents.repo';
import type { DurablePageRow, LayerRow } from '../db/repos/page_state.repo';
import type { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import type { ObjectStore } from '../storage/ObjectStore';
import { StorageKeys } from '../storage/keys';
import type { CloudRevisionBridge } from './CloudRevisionBridge';
import type { DocumentService, OpenContext } from './DocumentService';
import type { AuditEvent, EventLogService } from './EventLogService';
import type { LayerStateService } from './LayerStateService';
import type { MutationImpactKind } from './LayerStateService';
import type { WeakAnnotationSessionService } from './WeakAnnotationSessionService';

type LayerArtifactInput = { bytes: ArrayBuffer; size: number } | { path: string };

/** The durable state an annotation commit produced inside its transaction —
 *  the input `finalizePayload` turns into the wire result. */
interface CommittedAnnotationMutation {
  page: DurablePageRow;
  weakRefsInvalidated: boolean;
  previousLayerDocVersion: number;
  layerDocVersion: number;
}

export interface LayerServiceOptions {
  db?: Kysely<Schema>;
  documents: DocumentsRepo;
  layerState: LayerStateService;
  revisionBridge?: CloudRevisionBridge;
  documentService?: DocumentService;
  eventLog?: EventLogService;
  weakAnnotationSessions?: WeakAnnotationSessionService;
  pool?: WorkerThreadPool;
  storage?: ObjectStore;
}

export type LayerWriteContext = OpenContext;

export interface MaterializedLayer {
  layer: LayerRow;
  pages: DurablePageRow[];
}

/**
 * Write-side layer coordinator.
 *
 * Read paths intentionally virtualize never-created layers from
 * `document_pages` without creating DB rows. This service is the
 * mutation-side boundary: the first real write to `(docId, layerName)`
 * materializes the layer row and initializes layer-local page state.
 */
export class LayerService {
  private readonly db?: Kysely<Schema>;
  private readonly documents: DocumentsRepo;
  private readonly layerState: LayerStateService;
  private readonly revisionBridge?: CloudRevisionBridge;
  private readonly documentService?: DocumentService;
  private readonly eventLog?: EventLogService;
  private readonly weakAnnotationSessions?: WeakAnnotationSessionService;
  private readonly pool?: WorkerThreadPool;
  private readonly storage?: ObjectStore;
  private readonly layerWriteQueues = new Map<string, Promise<unknown>>();

  constructor(opts: LayerServiceOptions) {
    this.db = opts.db;
    this.documents = opts.documents;
    this.layerState = opts.layerState;
    this.revisionBridge = opts.revisionBridge;
    this.documentService = opts.documentService;
    this.eventLog = opts.eventLog;
    this.weakAnnotationSessions = opts.weakAnnotationSessions;
    this.pool = opts.pool;
    this.storage = opts.storage;
  }

  /**
   * Create or fetch the physical layer for a write.
   *
   * The initialized `layer_pages` rows copy only durable base topology
   * and weak-annotation truth. The base document is immutable, so
   * copying its counters is the initial layer epoch; after this point
   * only `layer_pages` advances.
   *
   * Callers must ensure `document_pages` has already been initialized
   * from PDFium before the first write. In the cloud route this happens
   * by opening the document/manifest through `DocumentService` first.
   */
  async materializeLayerForWrite(
    ctx: LayerWriteContext,
    docId: string,
    layerName: string,
  ): Promise<MaterializedLayer> {
    const doc = await this.documents.requireOwned(docId, ctx.tenantId);
    if (doc.state !== 'ready') {
      throw new EngineError(
        EngineErrorCode.DocOpenFailed,
        `cannot materialize layer for non-ready document: ${docId} (${doc.state})`,
      );
    }

    const basePages = await this.layerState.repos.documentPages.findByDocument(docId);
    if (basePages.length === 0) {
      throw new EngineError(
        EngineErrorCode.DocOpenFailed,
        `cannot materialize layer before base page state exists: ${docId}`,
      );
    }

    const layer = await this.layerState.repos.layers.createEmpty({
      id: `layer_${randomUUID()}`,
      docId,
      tenantId: ctx.tenantId,
      name: layerName,
    });
    const pages = await this.layerState.ensureLayerPagesFromBase({ layerId: layer.id, docId });
    return { layer, pages };
  }

  async createAnnotation(
    ctx: LayerWriteContext,
    input: {
      docId: string;
      layerName: string;
      pageObjectNumber: PageObjectNumber;
      draft: AnnotationDraft;
      /**
       * Optional actor override. When supplied, replaces the actor
       * built from `ctx.jwt.identity`. Routes pass this so that the
       * actor construction (and any future policy on it) lives next to
       * the capability check. The service trusts what arrives here.
       */
      actor?: AnnotationActor;
    },
    signal?: AbortSignal,
  ): Promise<AnnotationCreateResult> {
    const actor = input.actor ?? actorFromContext(ctx);
    return this.enqueueLayerWrite(ctx, input.docId, input.layerName, async () => {
      const { layer } = await this.prepareLayerMutation(ctx, input.docId, input.layerName);
      return this.withTempWorkerFile('layer-artifact', 'artifact.layer', async (artifactPath) => {
        const build = (jobId: WorkerJobId) =>
          wirePack({
            kind: 'annotations.create' as const,
            jobId,
            docId: input.docId,
            layerName: input.layerName,
            pageObjectNumber: input.pageObjectNumber,
            draft: input.draft,
            artifactPath,
            ...(actor ? { actor } : {}),
          });
        const payload = await this.requirePool().run(input.docId, build, signal);
        if (payload.tag !== 'annotations.create') {
          throw new EngineError(
            EngineErrorCode.WireFormat,
            `unexpected annotations.create payload: ${payload.tag}`,
          );
        }
        return this.persistAnnotationMutation(ctx, input.docId, input.layerName, layer, 'create', {
          result: payload.result,
          artifact: requireLayerArtifact(payload as unknown),
        });
      });
    });
  }

  async updateAnnotation(
    ctx: LayerWriteContext,
    input: {
      docId: string;
      layerName: string;
      ref: AnnotationRef;
      patch: AnnotationPatch;
      /**
       * Optional actor override. For UPDATE this is typically built
       * from the caller's JWT identity (for /UpdatedBy) PLUS any
       * `patch.groupId` reassignment. Authorization for the groupId
       * change is the route's job (`checkSetGroup`).
       */
      actor?: AnnotationActor;
    },
    signal?: AbortSignal,
  ): Promise<AnnotationUpdateResult> {
    const actor = input.actor ?? actorFromContext(ctx);
    return this.enqueueLayerWrite(ctx, input.docId, input.layerName, async () => {
      const { layer } = await this.prepareLayerMutation(ctx, input.docId, input.layerName);
      const ref = await this.rewriteRefForWorker(
        input.docId,
        input.layerName,
        layer,
        input.ref,
        signal,
      );
      return this.withTempWorkerFile('layer-artifact', 'artifact.layer', async (artifactPath) => {
        const build = (jobId: WorkerJobId) =>
          wirePack({
            kind: 'annotations.update' as const,
            jobId,
            docId: input.docId,
            layerName: input.layerName,
            ref,
            patch: input.patch,
            artifactPath,
            ...(actor ? { actor } : {}),
          });
        const payload = await this.requirePool().run(input.docId, build, signal);
        if (payload.tag !== 'annotations.update') {
          throw new EngineError(
            EngineErrorCode.WireFormat,
            `unexpected annotations.update payload: ${payload.tag}`,
          );
        }
        return this.persistAnnotationMutation(ctx, input.docId, input.layerName, layer, 'update', {
          result: payload.result,
          artifact: requireLayerArtifact(payload as unknown),
        });
      });
    });
  }

  /**
   * Resolve the collab subject (userId / groupId) of the target
   * annotation a PATCH or DELETE is about to act on. Route guards
   * call this BEFORE the mutation so `requireLayerCollabAction` can
   * deny with 403 without ever issuing a write.
   *
   * V1 implementation: page-fetch + filter. Reuses the existing
   * `annotations.listFullPage` worker job (the only annotation read
   * path the worker currently exposes) and finds the row matching
   * the ref. Returns an empty `{}` if the annotation can't be
   * located — the route guard then evaluates the collab filter against
   * an unstamped target, which denies self/group filters and allows
   * `all`. If the annotation truly doesn't exist, the subsequent
   * mutator call will throw the correct `InvalidReference`.
   *
   * Tracked as a follow-up optimisation: a dedicated worker job that
   * resolves ref → /EMBD_Metadata without serialising the whole page.
   */
  async getAnnotationCollabTarget(
    ctx: LayerWriteContext,
    docId: string,
    layerName: string,
    pageObjectNumber: PageObjectNumber,
    ref: AnnotationRef,
    signal?: AbortSignal,
  ): Promise<{ userId?: string; groupId?: string }> {
    // The worker job below assumes the layer is already attached to the
    // pool's session for `docId`. Most read paths already do this via
    // `documentService.ensureLayerOnPool`; collab gating runs before any
    // mutation, so we have to open it ourselves.
    await this.requireDocumentService().ensureLayerOnPool(ctx, docId, layerName);

    const build = (jobId: WorkerJobId) =>
      wirePack({
        kind: 'annotations.listFullPage' as const,
        jobId,
        docId,
        layerName,
        pageObjectNumber,
      });
    const payload = await this.requirePool().run(docId, build, signal);
    if (payload.tag !== 'annotations.listFullPage') {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `unexpected annotations.listFullPage payload while resolving collab target: ${payload.tag}`,
      );
    }
    const annotations = payload.snapshot.annotations;
    const match = annotations.find((a) => {
      // Refs match in three shapes; objectNumber and nm are durable
      // identities and the safest. Index is positional and resolved
      // after the mutator's `rewriteRefForWorker`, so we only see
      // pre-rewrite indices here — which is fine because the same
      // annotation list we're searching is what the rewriter would
      // resolve against.
      switch (ref.kind) {
        case 'objectNumber':
          return a.ref.kind === 'objectNumber' && a.ref.annotObjectNumber === ref.annotObjectNumber;
        case 'nm':
          return a.nm === ref.nm;
        case 'index':
          return a.index === ref.index;
      }
    });
    if (!match) return {};
    return {
      ...(match.userId !== undefined ? { userId: match.userId } : {}),
      ...(match.groupId !== undefined ? { groupId: match.groupId } : {}),
    };
  }

  async deleteAnnotation(
    ctx: LayerWriteContext,
    input: {
      docId: string;
      layerName: string;
      ref: AnnotationRef;
    },
    signal?: AbortSignal,
  ): Promise<AnnotationDeleteResult> {
    return this.enqueueLayerWrite(ctx, input.docId, input.layerName, async () => {
      const { layer } = await this.prepareLayerMutation(ctx, input.docId, input.layerName);
      await this.assertWeakAnnotationStructuralEditAllowed(ctx, {
        docId: input.docId,
        layerName: input.layerName,
        layer,
        pageObjectNumber: input.ref.pageObjectNumber,
      });
      const ref = await this.rewriteRefForWorker(
        input.docId,
        input.layerName,
        layer,
        input.ref,
        signal,
      );
      return this.withTempWorkerFile('layer-artifact', 'artifact.layer', async (artifactPath) => {
        const build = (jobId: WorkerJobId) =>
          wirePack({
            kind: 'annotations.delete' as const,
            jobId,
            docId: input.docId,
            layerName: input.layerName,
            ref,
            artifactPath,
          });
        const payload = await this.requirePool().run(input.docId, build, signal);
        if (payload.tag !== 'annotations.delete') {
          throw new EngineError(
            EngineErrorCode.WireFormat,
            `unexpected annotations.delete payload: ${payload.tag}`,
          );
        }
        return this.persistAnnotationMutation(ctx, input.docId, input.layerName, layer, 'delete', {
          result: payload.result,
          artifact: requireLayerArtifact(payload as unknown),
        });
      });
    });
  }

  async moveAnnotations(
    ctx: LayerWriteContext,
    input: {
      docId: string;
      layerName: string;
      pageObjectNumber: PageObjectNumber;
      refs: AnnotationRef[];
      toIndex: number;
    },
    signal?: AbortSignal,
  ): Promise<AnnotationMoveResult> {
    return this.enqueueLayerWrite(ctx, input.docId, input.layerName, async () => {
      const { layer } = await this.prepareLayerMutation(ctx, input.docId, input.layerName);
      await this.assertWeakAnnotationStructuralEditAllowed(ctx, {
        docId: input.docId,
        layerName: input.layerName,
        layer,
        pageObjectNumber: input.pageObjectNumber,
      });
      const refs = await Promise.all(
        input.refs.map((ref) =>
          this.rewriteRefForWorker(input.docId, input.layerName, layer, ref, signal),
        ),
      );
      return this.withTempWorkerFile('layer-artifact', 'artifact.layer', async (artifactPath) => {
        const build = (jobId: WorkerJobId) =>
          wirePack({
            kind: 'annotations.move' as const,
            jobId,
            docId: input.docId,
            layerName: input.layerName,
            pageObjectNumber: input.pageObjectNumber,
            refs,
            toIndex: input.toIndex,
            artifactPath,
          });
        const payload = await this.requirePool().run(input.docId, build, signal);
        if (payload.tag !== 'annotations.move') {
          throw new EngineError(
            EngineErrorCode.WireFormat,
            `unexpected annotations.move payload: ${payload.tag}`,
          );
        }
        return this.persistAnnotationMutation(ctx, input.docId, input.layerName, layer, 'move', {
          result: payload.result,
          artifact: requireLayerArtifact(payload as unknown),
        });
      });
    });
  }

  async movePages(
    ctx: LayerWriteContext,
    input: {
      docId: string;
      layerName: string;
      pageObjectNumbers: PageObjectNumber[];
      destIndex: number;
    },
    signal?: AbortSignal,
  ): Promise<PageMoveResult> {
    return this.enqueueLayerWrite(ctx, input.docId, input.layerName, async () => {
      const { layer } = await this.prepareLayerMutation(ctx, input.docId, input.layerName);
      return this.withTempWorkerFile('layer-artifact', 'artifact.layer', async (artifactPath) => {
        const build = (jobId: WorkerJobId) =>
          wirePack({
            kind: 'pages.move' as const,
            jobId,
            docId: input.docId,
            layerName: input.layerName,
            pageObjectNumbers: input.pageObjectNumbers,
            destIndex: input.destIndex,
            artifactPath,
          });
        const payload = await this.requirePool().run(input.docId, build, signal);
        if (payload.tag !== 'pages.move') {
          throw new EngineError(
            EngineErrorCode.WireFormat,
            `unexpected pages.move payload: ${payload.tag}`,
          );
        }
        return this.persistPageMove(ctx, input.docId, input.layerName, layer, {
          result: payload.result,
          artifact: requireLayerArtifact(payload as unknown),
        });
      });
    });
  }

  async rotatePages(
    ctx: LayerWriteContext,
    input: {
      docId: string;
      layerName: string;
      pageObjectNumbers: PageObjectNumber[];
      rotation: PageRotation;
    },
    signal?: AbortSignal,
  ): Promise<PageRotateResult> {
    return this.enqueueLayerWrite(ctx, input.docId, input.layerName, async () => {
      const { layer } = await this.prepareLayerMutation(ctx, input.docId, input.layerName);
      // No weak-session guard: rotation is presentation metadata — it never
      // touches a page's /Annots array, so no in-flight weak edit can break.
      return this.withTempWorkerFile('layer-artifact', 'artifact.layer', async (artifactPath) => {
        const build = (jobId: WorkerJobId) =>
          wirePack({
            kind: 'pages.rotate' as const,
            jobId,
            docId: input.docId,
            layerName: input.layerName,
            pageObjectNumbers: input.pageObjectNumbers,
            rotation: input.rotation,
            artifactPath,
          });
        const payload = await this.requirePool().run(input.docId, build, signal);
        if (payload.tag !== 'pages.rotate') {
          throw new EngineError(
            EngineErrorCode.WireFormat,
            `unexpected pages.rotate payload: ${payload.tag}`,
          );
        }
        return this.persistPageRotate(ctx, input.docId, input.layerName, layer, {
          result: payload.result,
          affectedPages: input.pageObjectNumbers,
          artifact: requireLayerArtifact(payload as unknown),
        });
      });
    });
  }

  async deletePages(
    ctx: LayerWriteContext,
    input: {
      docId: string;
      layerName: string;
      pageObjectNumbers: PageObjectNumber[];
    },
    signal?: AbortSignal,
  ): Promise<PageDeleteResult> {
    return this.enqueueLayerWrite(ctx, input.docId, input.layerName, async () => {
      const { layer } = await this.prepareLayerMutation(ctx, input.docId, input.layerName);
      // Destroying a page someone is mid-edit on is the collaboration
      // conflict the weak-session model exists for: for every target page
      // with weak annotations the caller must be the sole active editor.
      for (const pageObjectNumber of input.pageObjectNumbers) {
        await this.assertWeakAnnotationStructuralEditAllowed(ctx, {
          docId: input.docId,
          layerName: input.layerName,
          layer,
          pageObjectNumber,
        });
      }
      return this.withTempWorkerFile('layer-artifact', 'artifact.layer', async (artifactPath) => {
        const build = (jobId: WorkerJobId) =>
          wirePack({
            kind: 'pages.delete' as const,
            jobId,
            docId: input.docId,
            layerName: input.layerName,
            pageObjectNumbers: input.pageObjectNumbers,
            artifactPath,
          });
        const payload = await this.requirePool().run(input.docId, build, signal);
        if (payload.tag !== 'pages.delete') {
          throw new EngineError(
            EngineErrorCode.WireFormat,
            `unexpected pages.delete payload: ${payload.tag}`,
          );
        }
        return this.persistPageDelete(ctx, input.docId, input.layerName, layer, {
          result: payload.result,
          deletedPages: input.pageObjectNumbers,
          artifact: requireLayerArtifact(payload as unknown),
        });
      });
    });
  }

  async updateMetadata(
    ctx: LayerWriteContext,
    input: {
      docId: string;
      layerName: string;
      patch: MetadataPatch;
    },
    signal?: AbortSignal,
  ): Promise<MetadataUpdateResult> {
    return this.enqueueLayerWrite(ctx, input.docId, input.layerName, async () => {
      const { layer } = await this.prepareLayerMutation(ctx, input.docId, input.layerName);
      return this.withTempWorkerFile('layer-artifact', 'artifact.layer', async (artifactPath) => {
        const build = (jobId: WorkerJobId) =>
          wirePack({
            kind: 'metadata.update' as const,
            jobId,
            docId: input.docId,
            layerName: input.layerName,
            patch: input.patch,
            artifactPath,
          });
        const payload = await this.requirePool().run(input.docId, build, signal);
        if (payload.tag !== 'metadata.update') {
          throw new EngineError(
            EngineErrorCode.WireFormat,
            `unexpected metadata.update payload: ${payload.tag}`,
          );
        }
        return this.persistMetadataUpdate(ctx, input.docId, input.layerName, layer, {
          result: payload.result,
          artifact: requireLayerArtifact(payload as unknown),
        });
      });
    });
  }

  private async prepareLayerMutation(
    ctx: LayerWriteContext,
    docId: string,
    layerName: string,
  ): Promise<MaterializedLayer> {
    const documentService = this.requireDocumentService();
    await documentService.getLayerManifest(ctx, docId, layerName);
    const materialized = await this.materializeLayerForWrite(ctx, docId, layerName);
    await documentService.ensureLayerOnPool(ctx, docId, layerName);
    return materialized;
  }

  private async persistAnnotationMutation<
    TResult extends
      | AnnotationCreateResult
      | AnnotationUpdateResult
      | AnnotationDeleteResult
      | AnnotationMoveResult,
  >(
    ctx: LayerWriteContext,
    docId: string,
    layerName: string,
    layer: LayerRow,
    kind: MutationImpactKind,
    input: {
      result: TResult;
      artifact: LayerArtifactInput;
    },
  ): Promise<TResult> {
    const nextVersion = layer.currentVersion + 1;
    const artifactKey = StorageKeys.layerArtifact(ctx.tenantId, docId, layerName, nextVersion);
    const uploaded = await this.uploadLayerArtifact(artifactKey, input.artifact);
    const committed = await this.commitAnnotationMutation({
      ctx,
      docId,
      layerName,
      layer,
      pageObjectNumber: requireSingleAffectedPage(input.result.meta.affectedPages).pageObjectNumber,
      kind,
      artifactKey,
      artifactSha: uploaded.sha256,
      artifactSize: uploaded.size,
      nextVersion,
      hasWeakAnnotations: requireKnownWeakAnnotationBoolean(
        requireSingleAffectedPage(input.result.meta.affectedPages),
      ),
      finalizePayload: (durable) =>
        this.finalizeAnnotationResult(docId, layerName, input.result, durable),
    });
    // The response IS the audited payload — one fact for caller and history.
    return committed.payload as TResult;
  }

  /**
   * Turn the worker's session-relative result into the FINALIZED wire result:
   * cloud-stable revision tokens (the bridge's deterministic
   * `cloud:layer:{doc}:{layer}` scope + the durable generation) and the real
   * cacheDelta from the committed version bumps. Pure and synchronous — it
   * runs inside the commit transaction so the audit row can store its output.
   */
  private finalizeAnnotationResult<
    TResult extends
      | AnnotationCreateResult
      | AnnotationUpdateResult
      | AnnotationDeleteResult
      | AnnotationMoveResult,
  >(docId: string, layerName: string, raw: TResult, durable: CommittedAnnotationMutation): TResult {
    const cacheDelta = this.layerState.buildCacheDelta({
      docId,
      layerName,
      previousDocVersion: durable.previousLayerDocVersion,
      docVersion: durable.layerDocVersion,
      pages: [durable.page],
    });
    const pageState = this.layerState.decorateLayerPageState(docId, layerName, durable.page);
    const result = {
      ...raw,
      meta: {
        ...raw.meta,
        cacheDelta,
        affectedPages: [pageState],
        weakRefsInvalidated: durable.weakRefsInvalidated,
        shouldRefetch: durable.weakRefsInvalidated
          ? { reason: 'weakRefsInvalidated' as const }
          : null,
      },
    };
    return this.requireRevisionBridge().decorateAnnotationMutationResult([pageState], result);
  }

  private async persistPageMove(
    ctx: LayerWriteContext,
    docId: string,
    layerName: string,
    layer: LayerRow,
    input: {
      result: PageMoveResult;
      artifact: LayerArtifactInput;
    },
  ): Promise<PageMoveResult> {
    const nextVersion = layer.currentVersion + 1;
    const artifactKey = StorageKeys.layerArtifact(ctx.tenantId, docId, layerName, nextVersion);
    const uploaded = await this.uploadLayerArtifact(artifactKey, input.artifact);
    // The commit assembles, audits, and returns the finalized result (the
    // worker's layout + the coherence pins it just computed) — the response
    // is the audited payload, byte for byte.
    return this.commitPageStructure({
      ctx,
      docId,
      layerName,
      layer,
      kind: 'pages.move',
      layout: input.result.layout,
      // Every page's position is touched by a reorder.
      affectedPages: input.result.layout.pages.map((page) => page.pageObjectNumber),
      artifactKey,
      artifactSha: uploaded.sha256,
      artifactSize: uploaded.size,
      nextVersion,
    });
  }

  /**
   * Rotate shares the move commit EXACTLY (the corrected model: rotation is
   * presentation metadata — `doc_version` + `layout_version` bump, no
   * `layer_pages` touch, every per-page cache stays warm). Only the audit
   * kind and the affected-page set differ.
   */
  private async persistPageRotate(
    ctx: LayerWriteContext,
    docId: string,
    layerName: string,
    layer: LayerRow,
    input: {
      result: PageRotateResult;
      affectedPages: PageObjectNumber[];
      artifact: LayerArtifactInput;
    },
  ): Promise<PageRotateResult> {
    const nextVersion = layer.currentVersion + 1;
    const artifactKey = StorageKeys.layerArtifact(ctx.tenantId, docId, layerName, nextVersion);
    const uploaded = await this.uploadLayerArtifact(artifactKey, input.artifact);
    return this.commitPageStructure({
      ctx,
      docId,
      layerName,
      layer,
      kind: 'pages.rotate',
      layout: input.result.layout,
      affectedPages: input.affectedPages,
      artifactKey,
      artifactSha: uploaded.sha256,
      artifactSize: uploaded.size,
      nextVersion,
    });
  }

  private async persistPageDelete(
    ctx: LayerWriteContext,
    docId: string,
    layerName: string,
    layer: LayerRow,
    input: {
      result: PageDeleteResult;
      deletedPages: PageObjectNumber[];
      artifact: LayerArtifactInput;
    },
  ): Promise<PageDeleteResult> {
    const nextVersion = layer.currentVersion + 1;
    const artifactKey = StorageKeys.layerArtifact(ctx.tenantId, docId, layerName, nextVersion);
    const uploaded = await this.uploadLayerArtifact(artifactKey, input.artifact);
    return this.commitPageDelete({
      ctx,
      docId,
      layerName,
      layer,
      layout: input.result.layout,
      deletedPages: input.deletedPages,
      artifactKey,
      artifactSha: uploaded.sha256,
      artifactSize: uploaded.size,
      nextVersion,
    });
  }

  private async persistMetadataUpdate(
    ctx: LayerWriteContext,
    docId: string,
    layerName: string,
    layer: LayerRow,
    input: {
      result: MetadataUpdateResult;
      artifact: LayerArtifactInput;
    },
  ): Promise<MetadataUpdateResult> {
    const nextVersion = layer.currentVersion + 1;
    const artifactKey = StorageKeys.layerArtifact(ctx.tenantId, docId, layerName, nextVersion);
    const uploaded = await this.uploadLayerArtifact(artifactKey, input.artifact);
    // The commit assembles, audits, and returns the finalized result (the
    // worker's re-read metadata + the coherence pins it just computed) — the
    // response is the audited payload, byte for byte.
    return this.commitMetadataUpdate({
      ctx,
      docId,
      layerName,
      layer,
      metadata: input.result.metadata,
      artifactKey,
      artifactSha: uploaded.sha256,
      artifactSize: uploaded.size,
      nextVersion,
    });
  }

  private async uploadLayerArtifact(
    artifactKey: string,
    artifact: LayerArtifactInput,
  ): Promise<{ sha256: string; size: number }> {
    if ('path' in artifact) {
      const info = await stat(artifact.path);
      if (info.size <= 0) {
        throw new EngineError(
          EngineErrorCode.WireFormat,
          `layer artifact file is empty: ${artifact.path}`,
        );
      }
      const putResult = await this.requireStorage().put(
        artifactKey,
        createReadStream(artifact.path),
        {
          contentLength: info.size,
        },
      );
      return { sha256: putResult.sha256, size: info.size };
    }

    const artifactBytes = new Uint8Array(artifact.bytes);
    if (artifactBytes.byteLength !== artifact.size) {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `layer artifact size mismatch: payload=${artifactBytes.byteLength}, declared=${artifact.size}`,
      );
    }
    const putResult = await this.requireStorage().put(artifactKey, artifactBytes, {
      contentLength: artifact.size,
    });
    return { sha256: putResult.sha256, size: artifact.size };
  }

  private async withTempWorkerFile<T>(
    prefix: string,
    filename: string,
    fn: (path: string) => Promise<T>,
  ): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), `embedpdf-${prefix}-`));
    const path = join(dir, filename);
    try {
      return await fn(path);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async rewriteRefForWorker(
    docId: string,
    layerName: string,
    layer: LayerRow,
    ref: AnnotationRef,
    signal?: AbortSignal,
  ): Promise<AnnotationRef> {
    if (ref.kind !== 'index') return ref;

    const page = await this.requireLayerPage(layer.id, ref.pageObjectNumber);
    const durablePageState = this.layerState.decorateLayerPageState(docId, layerName, page);
    this.requireRevisionBridge().validateClientIndexRef(durablePageState, ref);
    const workerPageState = await this.loadWorkerPageState(
      docId,
      layerName,
      ref.pageObjectNumber,
      signal,
    );
    return this.requireRevisionBridge().rewriteIndexRefForWorker(workerPageState, ref);
  }

  private async loadWorkerPageState(
    docId: string,
    layerName: string,
    pageObjectNumber: PageObjectNumber,
    signal?: AbortSignal,
  ): Promise<PageState> {
    const build = (jobId: WorkerJobId) =>
      wirePack({
        kind: 'annotations.listFullPage' as const,
        jobId,
        docId,
        layerName,
        pageObjectNumber,
      });
    const payload = await this.requirePool().run(docId, build, signal);
    if (payload.tag !== 'annotations.listFullPage') {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `unexpected annotations.listFullPage payload while rewriting index ref: ${payload.tag}`,
      );
    }
    return payload.snapshot.pageState;
  }

  private async requireLayerPage(
    layerId: string,
    pageObjectNumber: PageObjectNumber,
  ): Promise<DurablePageRow> {
    const pages = await this.layerState.repos.layerPages.findByLayer(layerId);
    const page = pages.find((candidate) => candidate.pageObjectNumber === pageObjectNumber);
    if (!page) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `layer page ${pageObjectNumber} not found for layer ${layerId}`,
      );
    }
    return page;
  }

  private async assertWeakAnnotationStructuralEditAllowed(
    ctx: LayerWriteContext,
    input: {
      docId: string;
      layerName: string;
      layer: LayerRow;
      pageObjectNumber: PageObjectNumber;
    },
  ): Promise<void> {
    const page = await this.requireLayerPage(input.layer.id, input.pageObjectNumber);
    if (!page.hasWeakAnnotations) {
      return;
    }
    if (!this.weakAnnotationSessions) {
      throw new EngineError(
        EngineErrorCode.NotImplemented,
        'weak annotation session service is not configured',
      );
    }
    await this.weakAnnotationSessions.assertSoleEditorForWeakPage({
      tenantId: ctx.tenantId,
      docId: input.docId,
      layerName: input.layerName,
      sub: ctx.sub,
      pageObjectNumber: input.pageObjectNumber,
    });
  }

  private async commitAnnotationMutation(input: {
    ctx: LayerWriteContext;
    docId: string;
    layerName: string;
    layer: LayerRow;
    pageObjectNumber: number;
    kind: MutationImpactKind;
    artifactKey: string;
    artifactSha: string;
    artifactSize: number;
    nextVersion: number;
    hasWeakAnnotations: boolean;
    /**
     * Builds the FINALIZED result (cloud-stable revision tokens, real
     * cacheDelta) from the in-transaction durable state. Its return is what
     * the audit row stores AND what the caller receives — the invariant is
     * that the audited payload is byte-identical to the response: what we
     * tell the caller is what we tell history (and, later, every remote
     * event subscriber).
     */
    finalizePayload: (durable: CommittedAnnotationMutation) => unknown;
  }): Promise<{ durable: CommittedAnnotationMutation; payload: unknown }> {
    return this.requireDb()
      .transaction()
      .execute(async (trx) => {
        const now = Date.now();
        const currentLayer = await trx
          .selectFrom('layers')
          .select(['current_version', 'doc_version'])
          .where('id', '=', input.layer.id)
          .executeTakeFirst();
        if (!currentLayer) {
          throw new EngineError(EngineErrorCode.NotFound, `layer not found: ${input.layer.id}`);
        }
        if (Number(currentLayer.current_version) !== input.layer.currentVersion) {
          throw new EngineError(
            EngineErrorCode.Aborted,
            `layer version changed while saving artifact for ${input.layer.id}`,
          );
        }

        const page = await trx
          .selectFrom('layer_pages')
          .selectAll()
          .where('layer_id', '=', input.layer.id)
          .where('page_object_number', '=', input.pageObjectNumber)
          .executeTakeFirst();
        if (!page) {
          throw new EngineError(
            EngineErrorCode.NotFound,
            `layer page ${input.pageObjectNumber} not found for layer ${input.layer.id}`,
          );
        }

        const bumps = this.layerState.mutationBumps(input.kind, {
          hasWeakAnnotations: Boolean(page.has_weak_annotations),
        });
        const nextPage: DurablePageRow = {
          pageObjectNumber: Number(page.page_object_number),
          contentVersion: Number(page.content_version) + (bumps.bumpContentVersion ? 1 : 0),
          annotationVersion:
            Number(page.annotation_version) + (bumps.bumpAnnotationVersion ? 1 : 0),
          annotationGeneration:
            Number(page.annotation_generation) + (bumps.bumpAnnotationGeneration ? 1 : 0),
          hasWeakAnnotations: input.hasWeakAnnotations,
          updatedAt: now,
        };

        const previousLayerDocVersion = Number(currentLayer.doc_version);
        const layerDocVersion = previousLayerDocVersion + (bumps.bumpLayerDocVersion ? 1 : 0);

        await trx
          .updateTable('layers')
          .set({
            doc_version: layerDocVersion,
            current_version: input.nextVersion,
            current_artifact_key: input.artifactKey,
            current_artifact_sha: input.artifactSha,
            current_artifact_size: input.artifactSize,
            updated_at: now,
          })
          .where('id', '=', input.layer.id)
          .execute();

        await trx
          .updateTable('layer_pages')
          .set({
            content_version: nextPage.contentVersion,
            annotation_version: nextPage.annotationVersion,
            annotation_generation: nextPage.annotationGeneration,
            has_weak_annotations: nextPage.hasWeakAnnotations ? 1 : 0,
            updated_at: now,
          })
          .where('layer_id', '=', input.layer.id)
          .where('page_object_number', '=', input.pageObjectNumber)
          .execute();

        const durable: CommittedAnnotationMutation = {
          page: nextPage,
          weakRefsInvalidated: bumps.weakRefsInvalidated,
          previousLayerDocVersion,
          layerDocVersion,
        };
        // Finalize BEFORE the audit append so the row stores exactly what the
        // caller will receive (cloud-stable tokens + real cacheDelta), never
        // the worker's session-relative draft.
        const payload = input.finalizePayload(durable);

        const auditEvent = makeAuditEvent({
          ctx: input.ctx,
          docId: input.docId,
          layer: input.layer,
          layerName: input.layerName,
          kind: `annot.${input.kind}` as AuditEvent['kind'],
          pageObjectNumber: input.pageObjectNumber,
          affectedPages: [input.pageObjectNumber],
          artifactVersion: input.nextVersion,
          artifactKey: input.artifactKey,
          artifactSha: input.artifactSha,
          artifactSize: input.artifactSize,
          payload,
          ts: now,
        });
        await this.eventLog?.appendDb(trx, auditEvent);

        return { durable, payload };
      });
  }

  /**
   * Shared commit for the page-structure ops that keep the page SET intact
   * (move + rotate). Both have the same shape: the layer's `doc_version` and
   * `layout_version` advance, `layer_pages` rows are left entirely untouched
   * (display order and rotation live in the artifact, read back via /layout),
   * and every per-page content/annotation cache stays warm.
   */
  private async commitPageStructure(input: {
    ctx: LayerWriteContext;
    docId: string;
    layerName: string;
    layer: LayerRow;
    kind: 'pages.move' | 'pages.rotate';
    /** The worker's post-mutation layout — becomes `result.layout`. */
    layout: PageListSnapshot;
    affectedPages: PageObjectNumber[];
    artifactKey: string;
    artifactSha: string;
    artifactSize: number;
    nextVersion: number;
  }): Promise<{ layout: PageListSnapshot; cache: PageStructureCache }> {
    return this.requireDb()
      .transaction()
      .execute(async (trx) => {
        const now = Date.now();
        const currentLayer = await this.requireUnchangedLayer(trx, input.layer);

        // The worker's layout IS the new order; validate its page set against
        // the durable rows before trusting it.
        const pageOrder = input.layout.pages.map((page) => page.pageObjectNumber);
        const rows = await trx
          .selectFrom('layer_pages')
          .select('page_object_number')
          .where('layer_id', '=', input.layer.id)
          .execute();
        if (rows.length !== pageOrder.length) {
          throw new EngineError(
            EngineErrorCode.WireFormat,
            `${input.kind} returned ${pageOrder.length} pages for ${rows.length} layer page rows`,
          );
        }
        const known = new Set(rows.map((row) => Number(row.page_object_number)));
        for (const pageObjectNumber of pageOrder) {
          if (!known.has(pageObjectNumber)) {
            throw new EngineError(
              EngineErrorCode.WireFormat,
              `${input.kind} returned unknown page object number ${pageObjectNumber}`,
            );
          }
        }

        const versions = await this.advanceLayerVersions(trx, input, currentLayer, now);

        // The finalized result — audited and returned IDENTICALLY: what we
        // tell the caller is what we tell history (and remote subscribers).
        const result = { layout: input.layout, cache: versions };

        const auditEvent = makeAuditEvent({
          ctx: input.ctx,
          docId: input.docId,
          layer: input.layer,
          layerName: input.layerName,
          kind: input.kind,
          pageObjectNumber: null,
          affectedPages: input.affectedPages,
          artifactVersion: input.nextVersion,
          artifactKey: input.artifactKey,
          artifactSha: input.artifactSha,
          artifactSize: input.artifactSize,
          payload: result,
          ts: now,
        });
        await this.eventLog?.appendDb(trx, auditEvent);

        return result;
      });
  }

  /**
   * Delete commit: the only page-structure op that mutates the page SET. On
   * top of the shared version bumps it removes the deleted pages'
   * `layer_pages` rows and any weak-annotation-session claims on them
   * (sessions themselves survive — they may hold other pages). Surviving
   * pages' rows are untouched, so their pins and revisions stay warm.
   */
  private async commitPageDelete(input: {
    ctx: LayerWriteContext;
    docId: string;
    layerName: string;
    layer: LayerRow;
    /** The worker's post-delete layout (survivors) — becomes `result.layout`. */
    layout: PageListSnapshot;
    deletedPages: PageObjectNumber[];
    artifactKey: string;
    artifactSha: string;
    artifactSize: number;
    nextVersion: number;
  }): Promise<{ layout: PageListSnapshot; cache: PageStructureCache }> {
    return this.requireDb()
      .transaction()
      .execute(async (trx) => {
        const now = Date.now();
        const currentLayer = await this.requireUnchangedLayer(trx, input.layer);

        const rows = await trx
          .selectFrom('layer_pages')
          .select('page_object_number')
          .where('layer_id', '=', input.layer.id)
          .execute();
        const known = new Set(rows.map((row) => Number(row.page_object_number)));
        const deleted = new Set(input.deletedPages);
        const survivorOrder = input.layout.pages.map((page) => page.pageObjectNumber);
        if (rows.length !== survivorOrder.length + input.deletedPages.length) {
          throw new EngineError(
            EngineErrorCode.WireFormat,
            `pages.delete returned ${survivorOrder.length} survivors for ${rows.length} layer page rows minus ${input.deletedPages.length} deleted`,
          );
        }
        for (const pageObjectNumber of input.deletedPages) {
          if (!known.has(pageObjectNumber)) {
            throw new EngineError(
              EngineErrorCode.WireFormat,
              `pages.delete removed unknown page object number ${pageObjectNumber}`,
            );
          }
        }
        for (const pageObjectNumber of survivorOrder) {
          if (!known.has(pageObjectNumber) || deleted.has(pageObjectNumber)) {
            throw new EngineError(
              EngineErrorCode.WireFormat,
              `pages.delete returned unexpected surviving page object number ${pageObjectNumber}`,
            );
          }
        }

        await trx
          .deleteFrom('layer_pages')
          .where('layer_id', '=', input.layer.id)
          .where('page_object_number', 'in', input.deletedPages)
          .execute();

        // Weak-annotation sessions of THIS layer lose their claims on the
        // deleted pages (the guard ran pre-worker; this is the cleanup).
        const sessions = await trx
          .selectFrom('weak_annotation_sessions')
          .select('id')
          .where('tenant_id', '=', input.ctx.tenantId)
          .where('doc_id', '=', input.docId)
          .where('layer_name', '=', input.layerName)
          .execute();
        if (sessions.length > 0) {
          await trx
            .deleteFrom('weak_annotation_session_pages')
            .where(
              'session_id',
              'in',
              sessions.map((session) => session.id),
            )
            .where('page_object_number', 'in', input.deletedPages)
            .execute();
        }

        const versions = await this.advanceLayerVersions(trx, input, currentLayer, now);

        // The finalized result — audited and returned IDENTICALLY: what we
        // tell the caller is what we tell history (and remote subscribers).
        const result = { layout: input.layout, cache: versions };

        const auditEvent = makeAuditEvent({
          ctx: input.ctx,
          docId: input.docId,
          layer: input.layer,
          layerName: input.layerName,
          kind: 'pages.delete',
          pageObjectNumber: null,
          affectedPages: input.deletedPages,
          artifactVersion: input.nextVersion,
          artifactKey: input.artifactKey,
          artifactSha: input.artifactSha,
          artifactSize: input.artifactSize,
          payload: result,
          ts: now,
        });
        await this.eventLog?.appendDb(trx, auditEvent);

        return result;
      });
  }

  /** Re-read the layer inside the commit transaction and reject if another
   *  write advanced it since `prepareLayerMutation` (the optimistic check
   *  every structure commit shares). */
  private async requireUnchangedLayer(
    trx: Transaction<Schema>,
    layer: LayerRow,
  ): Promise<{ doc_version: number | bigint; layout_version: number | bigint }> {
    const currentLayer = await trx
      .selectFrom('layers')
      .select(['current_version', 'doc_version', 'layout_version'])
      .where('id', '=', layer.id)
      .executeTakeFirst();
    if (!currentLayer) {
      throw new EngineError(EngineErrorCode.NotFound, `layer not found: ${layer.id}`);
    }
    if (Number(currentLayer.current_version) !== layer.currentVersion) {
      throw new EngineError(
        EngineErrorCode.Aborted,
        `layer version changed while saving artifact for ${layer.id}`,
      );
    }
    return currentLayer;
  }

  /** Advance the structural version pointers (`doc_version`, the CDN
   *  `layout_version` leaf) and the artifact epoch — shared by every
   *  page-structure commit. Per-page versions are never touched here. */
  private async advanceLayerVersions(
    trx: Transaction<Schema>,
    input: {
      layer: LayerRow;
      nextVersion: number;
      artifactKey: string;
      artifactSha: string;
      artifactSize: number;
    },
    currentLayer: { doc_version: number | bigint; layout_version: number | bigint },
    now: number,
  ): Promise<PageStructureCache> {
    const previousDocVersion = Number(currentLayer.doc_version);
    const docVersion = previousDocVersion + 1;
    const layoutVersion = Number(currentLayer.layout_version) + 1;

    await trx
      .updateTable('layers')
      .set({
        doc_version: docVersion,
        layout_version: layoutVersion,
        current_version: input.nextVersion,
        current_artifact_key: input.artifactKey,
        current_artifact_sha: input.artifactSha,
        current_artifact_size: input.artifactSize,
        updated_at: now,
      })
      .where('id', '=', input.layer.id)
      .execute();

    return { previousDocVersion, docVersion, layoutVersion };
  }

  private async commitMetadataUpdate(input: {
    ctx: LayerWriteContext;
    docId: string;
    layerName: string;
    layer: LayerRow;
    /** The worker's re-read metadata — becomes `result.metadata`. */
    metadata: MetadataUpdateResult['metadata'];
    artifactKey: string;
    artifactSha: string;
    artifactSize: number;
    nextVersion: number;
  }): Promise<MetadataUpdateResult> {
    return this.requireDb()
      .transaction()
      .execute(async (trx) => {
        const now = Date.now();
        const currentLayer = await trx
          .selectFrom('layers')
          .select(['current_version', 'doc_version', 'metadata_version'])
          .where('id', '=', input.layer.id)
          .executeTakeFirst();
        if (!currentLayer) {
          throw new EngineError(EngineErrorCode.NotFound, `layer not found: ${input.layer.id}`);
        }
        if (Number(currentLayer.current_version) !== input.layer.currentVersion) {
          throw new EngineError(
            EngineErrorCode.Aborted,
            `layer version changed while saving artifact for ${input.layer.id}`,
          );
        }

        // A metadata write touches only the document Info dict — no page set,
        // no per-page versions, no display order. So `layer_pages` rows are
        // left entirely untouched; we only advance the layer version pointers.
        const previousLayerDocVersion = Number(currentLayer.doc_version);
        const layerDocVersion = previousLayerDocVersion + 1;
        // Metadata edit: bump the metadata pointer so the CDN-immutable
        // /metadata@metadataVersion leaf is re-fetched. Layout + per-page
        // content/annotation versions stay put (their caches stay warm).
        const metadataVersion = Number(currentLayer.metadata_version) + 1;

        await trx
          .updateTable('layers')
          .set({
            doc_version: layerDocVersion,
            metadata_version: metadataVersion,
            current_version: input.nextVersion,
            current_artifact_key: input.artifactKey,
            current_artifact_sha: input.artifactSha,
            current_artifact_size: input.artifactSize,
            updated_at: now,
          })
          .where('id', '=', input.layer.id)
          .execute();

        // The finalized result — audited and returned IDENTICALLY: what we
        // tell the caller is what we tell history (and remote subscribers).
        const result: MetadataUpdateResult = {
          metadata: input.metadata,
          cache: {
            previousDocVersion: previousLayerDocVersion,
            docVersion: layerDocVersion,
            metadataVersion,
          },
        };

        const auditEvent = makeAuditEvent({
          ctx: input.ctx,
          docId: input.docId,
          layer: input.layer,
          layerName: input.layerName,
          kind: 'metadata.update',
          pageObjectNumber: null,
          affectedPages: [],
          artifactVersion: input.nextVersion,
          artifactKey: input.artifactKey,
          artifactSha: input.artifactSha,
          artifactSize: input.artifactSize,
          payload: result,
          ts: now,
        });
        await this.eventLog?.appendDb(trx, auditEvent);

        return result;
      });
  }

  private enqueueLayerWrite<T>(
    ctx: LayerWriteContext,
    docId: string,
    layerName: string,
    op: () => Promise<T>,
  ): Promise<T> {
    const key = `${ctx.tenantId}::${docId}::${layerName}`;
    const previous = this.layerWriteQueues.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(op);

    const queueEntry = operation
      .catch(() => undefined)
      .finally(() => {
        if (this.layerWriteQueues.get(key) === queueEntry) {
          this.layerWriteQueues.delete(key);
        }
      });

    this.layerWriteQueues.set(key, queueEntry);
    return operation;
  }

  private requireDb(): Kysely<Schema> {
    if (!this.db) {
      throw new EngineError(EngineErrorCode.NotImplemented, 'LayerService DB is not configured');
    }
    return this.db;
  }

  private requireDocumentService(): DocumentService {
    if (!this.documentService) {
      throw new EngineError(
        EngineErrorCode.NotImplemented,
        'LayerService document service is not configured',
      );
    }
    return this.documentService;
  }

  private requireRevisionBridge(): CloudRevisionBridge {
    if (!this.revisionBridge) {
      throw new EngineError(
        EngineErrorCode.NotImplemented,
        'LayerService revision bridge is not configured',
      );
    }
    return this.revisionBridge;
  }

  private requirePool(): WorkerThreadPool {
    if (!this.pool) {
      throw new EngineError(
        EngineErrorCode.NotImplemented,
        'LayerService worker pool is not configured',
      );
    }
    return this.pool;
  }

  private requireStorage(): ObjectStore {
    if (!this.storage) {
      throw new EngineError(
        EngineErrorCode.NotImplemented,
        'LayerService storage is not configured',
      );
    }
    return this.storage;
  }
}

function makeAuditEvent(input: {
  ctx: LayerWriteContext;
  docId: string;
  layer: LayerRow;
  layerName: string;
  kind: AuditEvent['kind'];
  pageObjectNumber: number | null;
  affectedPages: number[];
  artifactVersion: number;
  artifactKey: string;
  artifactSha: string;
  artifactSize: number;
  payload: unknown;
  ts: number;
}): AuditEvent {
  return {
    tenantId: input.ctx.tenantId,
    docId: input.docId,
    layerId: input.layer.id,
    layerName: input.layerName,
    ts: input.ts,
    sub: input.ctx.sub,
    kind: input.kind,
    pageObjectNumber: input.pageObjectNumber,
    affectedPages: input.affectedPages,
    artifactVersion: input.artifactVersion,
    artifactKey: input.artifactKey,
    artifactSha: input.artifactSha,
    artifactSize: input.artifactSize,
    idempotencyKey: null,
    payload: input.payload,
  };
}

function requireLayerArtifact(payload: unknown): LayerArtifactInput {
  const source =
    payload && typeof payload === 'object'
      ? (payload as {
          artifact?: { bytes: ArrayBuffer; size: number };
          artifactFile?: { path: string };
        })
      : undefined;
  const artifact = source?.artifact ?? source?.artifactFile;
  if (!artifact) {
    throw new EngineError(
      EngineErrorCode.WireFormat,
      'layer mutation did not return a saved layer artifact',
    );
  }
  return artifact;
}

function requireSingleAffectedPage(pages: readonly PageState[]): PageState {
  if (pages.length !== 1) {
    throw new EngineError(
      EngineErrorCode.WireFormat,
      `annotation mutation expected exactly one affected page, got ${pages.length}`,
    );
  }
  return pages[0];
}

function requireKnownWeakAnnotationBoolean(page: PageState): boolean {
  if (page.weakAnnotationState.kind !== 'known') {
    throw new EngineError(
      EngineErrorCode.WireFormat,
      `annotation mutation returned unknown weak annotation state for page ${page.pageObjectNumber}`,
    );
  }
  return page.weakAnnotationState.hasAnyWeakAnnotations;
}

/**
 * Project the request's JWT identity claims into the wire-shape
 * `AnnotationActor` the worker uses to stamp /T, /M, and /EMBD_Metadata.
 *
 * Returns `undefined` when:
 *   - no JWT identity is attached to the context (tenant tokens, dev
 *     fixtures without identity claims), OR
 *   - the identity has neither `user_id` nor `group_id` nor
 *     `display_name` (nothing meaningful to stamp)
 *
 * The worker treats an absent actor as "stamp /M only, skip EMBD_Metadata".
 */
function actorFromContext(ctx: LayerWriteContext): AnnotationActor | undefined {
  const id: IdentityClaims | undefined = ctx.jwt?.identity;
  if (!id) return undefined;
  const actor: AnnotationActor = {};
  if (id.user_id) actor.userId = id.user_id;
  if (id.group_id) actor.groupId = id.group_id;
  if (id.display_name) actor.displayName = id.display_name;
  // No fields set → nothing for the worker to stamp; signal absence.
  if (!actor.userId && !actor.groupId && !actor.displayName) return undefined;
  return actor;
}
