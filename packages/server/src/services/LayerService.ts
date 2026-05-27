import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  type PageMoveResult,
  type PageObjectNumber,
  type PageState,
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
    },
    signal?: AbortSignal,
  ): Promise<AnnotationCreateResult> {
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
    const durable = await this.commitAnnotationMutation({
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
      payload: input.result,
    });
    const cacheDelta = this.layerState.buildCacheDelta({
      docId,
      layerName,
      previousDocVersion: durable.previousLayerDocVersion,
      docVersion: durable.layerDocVersion,
      pages: [durable.page],
    });

    const pageState = this.layerState.decorateLayerPageState(docId, layerName, durable.page);
    const result = {
      ...input.result,
      meta: {
        ...input.result.meta,
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
    const committed = await this.commitPageMove({
      ctx,
      docId,
      layerName,
      layer,
      pageOrder: input.result.meta.affectedPages.map((page) => page.pageObjectNumber),
      artifactKey,
      artifactSha: uploaded.sha256,
      artifactSize: uploaded.size,
      nextVersion,
      payload: input.result,
    });
    const cacheDelta = this.layerState.buildCacheDelta({
      docId,
      layerName,
      previousDocVersion: committed.previousLayerDocVersion,
      docVersion: committed.layerDocVersion,
      pages: [],
    });

    return {
      meta: {
        affectedPages: committed.pages.map((page) =>
          this.layerState.decorateLayerPageState(docId, layerName, page),
        ),
        cacheDelta,
      },
    };
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
    payload: unknown;
  }): Promise<{
    page: DurablePageRow;
    weakRefsInvalidated: boolean;
    previousLayerDocVersion: number;
    layerDocVersion: number;
  }> {
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
          payload: input.payload,
          ts: now,
        });
        await this.eventLog?.appendDb(trx, auditEvent);

        return {
          page: nextPage,
          weakRefsInvalidated: bumps.weakRefsInvalidated,
          previousLayerDocVersion,
          layerDocVersion,
        };
      });
  }

  private async commitPageMove(input: {
    ctx: LayerWriteContext;
    docId: string;
    layerName: string;
    layer: LayerRow;
    pageOrder: PageObjectNumber[];
    artifactKey: string;
    artifactSha: string;
    artifactSize: number;
    nextVersion: number;
    payload: unknown;
  }): Promise<{
    pages: DurablePageRow[];
    previousLayerDocVersion: number;
    layerDocVersion: number;
  }> {
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

        const rows = await trx
          .selectFrom('layer_pages')
          .selectAll()
          .where('layer_id', '=', input.layer.id)
          .execute();
        if (rows.length !== input.pageOrder.length) {
          throw new EngineError(
            EngineErrorCode.WireFormat,
            `pages.move returned ${input.pageOrder.length} pages for ${rows.length} layer page rows`,
          );
        }

        const byObjectNumber = new Map(rows.map((row) => [Number(row.page_object_number), row]));
        const nextPages: DurablePageRow[] = input.pageOrder.map((pageObjectNumber, pageIndex) => {
          const row = byObjectNumber.get(pageObjectNumber);
          if (!row) {
            throw new EngineError(
              EngineErrorCode.WireFormat,
              `pages.move returned unknown page object number ${pageObjectNumber}`,
            );
          }
          return {
            pageObjectNumber,
            pageIndex,
            contentVersion: Number(row.content_version),
            annotationVersion: Number(row.annotation_version),
            annotationGeneration: Number(row.annotation_generation),
            hasWeakAnnotations: Boolean(row.has_weak_annotations),
            updatedAt: now,
          };
        });

        const previousLayerDocVersion = Number(currentLayer.doc_version);
        const layerDocVersion = previousLayerDocVersion + 1;

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

        const maxPageIndex = rows.reduce((max, row) => Math.max(max, Number(row.page_index)), -1);
        const stagingOffset = maxPageIndex + rows.length + 1;
        // `layer_pages` enforces unique `(layer_id, page_index)`.
        // Reordering is a valid permutation, but row-by-row updates can
        // temporarily collide with another row's old index. Move the whole
        // layer into an out-of-band index range inside this transaction, then
        // write the canonical final order. Readers only see old-or-new
        // committed state, never this staging range.
        await trx
          .updateTable('layer_pages')
          .set((eb) => ({
            page_index: eb('page_index', '+', stagingOffset),
            updated_at: now,
          }))
          .where('layer_id', '=', input.layer.id)
          .execute();

        for (const page of nextPages) {
          await trx
            .updateTable('layer_pages')
            .set({
              page_index: page.pageIndex,
              updated_at: now,
            })
            .where('layer_id', '=', input.layer.id)
            .where('page_object_number', '=', page.pageObjectNumber)
            .execute();
        }

        const auditEvent = makeAuditEvent({
          ctx: input.ctx,
          docId: input.docId,
          layer: input.layer,
          layerName: input.layerName,
          kind: 'pages.move',
          pageObjectNumber: null,
          affectedPages: input.pageOrder,
          artifactVersion: input.nextVersion,
          artifactKey: input.artifactKey,
          artifactSha: input.artifactSha,
          artifactSize: input.artifactSize,
          payload: input.payload,
          ts: now,
        });
        await this.eventLog?.appendDb(trx, auditEvent);

        return { pages: nextPages, previousLayerDocVersion, layerDocVersion };
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
