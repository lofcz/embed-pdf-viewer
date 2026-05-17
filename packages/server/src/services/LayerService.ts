import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import {
  EngineError,
  EngineErrorCode,
  wirePack,
  type AnnotationCreateResult,
  type AnnotationDeleteResult,
  type AnnotationDraft,
  type AnnotationMoveResult,
  type AnnotationPatch,
  type AnnotationRef,
  type AnnotationUpdateResult,
  type PageObjectNumber,
  type RevisionToken,
  type WorkerJobId,
} from '@embedpdf/engine-core/runtime';
import type { Database as Schema } from '../db/schema';
import type { DocumentsRepo } from '../db/repos/documents.repo';
import type { DurablePageRow, LayerRow } from '../db/repos/page_state.repo';
import type { WorkerThreadPool } from '../runtime/WorkerThreadPool';
import type { ObjectStore } from '../storage/ObjectStore';
import { StorageKeys } from '../storage/keys';
import type { DocumentService } from './DocumentService';
import type { LayerStateService } from './LayerStateService';
import type { MutationImpactKind } from './LayerStateService';

export interface LayerServiceOptions {
  db?: Kysely<Schema>;
  documents: DocumentsRepo;
  layerState: LayerStateService;
  documentService?: DocumentService;
  pool?: WorkerThreadPool;
  storage?: ObjectStore;
}

export interface LayerWriteContext {
  tenantId: string;
  sub: string;
}

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
  private readonly documentService?: DocumentService;
  private readonly pool?: WorkerThreadPool;
  private readonly storage?: ObjectStore;
  private readonly layerWriteQueues = new Map<string, Promise<unknown>>();

  constructor(opts: LayerServiceOptions) {
    this.db = opts.db;
    this.documents = opts.documents;
    this.layerState = opts.layerState;
    this.documentService = opts.documentService;
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
    },
    signal?: AbortSignal,
  ): Promise<AnnotationCreateResult> {
    return this.enqueueLayerWrite(ctx, input.docId, input.layerName, async () => {
      const { layer } = await this.prepareLayerMutation(ctx, input.docId, input.layerName);
      const build = (jobId: WorkerJobId) =>
        wirePack({
          kind: 'annotations.create' as const,
          jobId,
          docId: input.docId,
          layerName: input.layerName,
          pageObjectNumber: input.pageObjectNumber,
          draft: input.draft,
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
  }

  async updateAnnotation(
    ctx: LayerWriteContext,
    input: {
      docId: string;
      layerName: string;
      ref: AnnotationRef;
      patch: AnnotationPatch;
    },
    signal?: AbortSignal,
  ): Promise<AnnotationUpdateResult> {
    return this.enqueueLayerWrite(ctx, input.docId, input.layerName, async () => {
      const { layer } = await this.prepareLayerMutation(ctx, input.docId, input.layerName);
      const ref = await this.rewriteRefForWorker(
        input.docId,
        input.layerName,
        layer,
        input.ref,
        signal,
      );
      const build = (jobId: WorkerJobId) =>
        wirePack({
          kind: 'annotations.update' as const,
          jobId,
          docId: input.docId,
          layerName: input.layerName,
          ref,
          patch: input.patch,
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
      const ref = await this.rewriteRefForWorker(
        input.docId,
        input.layerName,
        layer,
        input.ref,
        signal,
      );
      const build = (jobId: WorkerJobId) =>
        wirePack({
          kind: 'annotations.delete' as const,
          jobId,
          docId: input.docId,
          layerName: input.layerName,
          ref,
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
      const refs = await Promise.all(
        input.refs.map((ref) =>
          this.rewriteRefForWorker(input.docId, input.layerName, layer, ref, signal),
        ),
      );
      const build = (jobId: WorkerJobId) =>
        wirePack({
          kind: 'annotations.move' as const,
          jobId,
          docId: input.docId,
          layerName: input.layerName,
          pageObjectNumber: input.pageObjectNumber,
          refs,
          toIndex: input.toIndex,
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
      artifact: { bytes: ArrayBuffer; size: number };
    },
  ): Promise<TResult> {
    const nextVersion = layer.currentVersion + 1;
    const artifactKey = StorageKeys.layerArtifact(ctx.tenantId, docId, layerName, nextVersion);
    const artifactBytes = new Uint8Array(input.artifact.bytes);
    if (artifactBytes.byteLength !== input.artifact.size) {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `layer artifact size mismatch: payload=${artifactBytes.byteLength}, declared=${input.artifact.size}`,
      );
    }
    const putResult = await this.requireStorage().put(artifactKey, artifactBytes, {
      contentLength: input.artifact.size,
    });
    const durablePage = await this.commitAnnotationMutation({
      layer,
      pageObjectNumber: input.result.meta.pageState.pageObjectNumber,
      kind,
      artifactKey,
      artifactSha: putResult.sha256,
      artifactSize: input.artifact.size,
      nextVersion,
      hasWeakAnnotations: input.result.meta.pageState.hasAnyWeakAnnotations,
    });

    return {
      ...input.result,
      meta: {
        ...input.result.meta,
        pageState: this.layerState.decorateLayerPageState(docId, layerName, durablePage.page),
        weakRefsInvalidated: durablePage.weakRefsInvalidated,
        shouldRefetch: durablePage.weakRefsInvalidated
          ? { reason: 'weakRefsInvalidated' as const }
          : null,
      },
    };
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
    this.layerState.validateLayerIndexRef({ docId, layerName, page, ref });
    const workerRevision = await this.loadWorkerPageRevision(
      docId,
      layerName,
      ref.pageObjectNumber,
      signal,
    );
    return { ...ref, revision: workerRevision };
  }

  private async loadWorkerPageRevision(
    docId: string,
    layerName: string,
    pageObjectNumber: PageObjectNumber,
    signal?: AbortSignal,
  ): Promise<RevisionToken> {
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
    return payload.snapshot.pageState.revision;
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

  private async commitAnnotationMutation(input: {
    layer: LayerRow;
    pageObjectNumber: number;
    kind: MutationImpactKind;
    artifactKey: string;
    artifactSha: string;
    artifactSize: number;
    nextVersion: number;
    hasWeakAnnotations: boolean;
  }): Promise<{ page: DurablePageRow; weakRefsInvalidated: boolean }> {
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
          pageIndex: Number(page.page_index),
          contentVersion: Number(page.content_version) + (bumps.bumpContentVersion ? 1 : 0),
          annotationVersion:
            Number(page.annotation_version) + (bumps.bumpAnnotationVersion ? 1 : 0),
          annotationGeneration:
            Number(page.annotation_generation) + (bumps.bumpAnnotationGeneration ? 1 : 0),
          hasWeakAnnotations: input.hasWeakAnnotations,
          updatedAt: now,
        };

        await trx
          .updateTable('layers')
          .set({
            doc_version: Number(currentLayer.doc_version) + (bumps.bumpLayerDocVersion ? 1 : 0),
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

        return { page: nextPage, weakRefsInvalidated: bumps.weakRefsInvalidated };
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

function requireLayerArtifact(payload: unknown): { bytes: ArrayBuffer; size: number } {
  const artifact =
    payload && typeof payload === 'object'
      ? (payload as { artifact?: { bytes: ArrayBuffer; size: number } }).artifact
      : undefined;
  if (!artifact) {
    throw new EngineError(
      EngineErrorCode.WireFormat,
      'layer mutation did not return a saved layer artifact',
    );
  }
  return artifact;
}
