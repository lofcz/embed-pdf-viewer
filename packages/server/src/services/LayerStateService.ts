import type {
  AnnotationMutationKind,
  PageState,
  PageTextSnapshot,
} from '@embedpdf/engine-core/runtime';
import { changesAnnotationList, invalidatesWeakIndexRefs } from '@embedpdf/engine-core/runtime';
import type { DocumentManifest, ManifestPage } from '@embedpdf/engine-core/wire';
import type {
  DocumentPagesRepo,
  DurablePageRow,
  LayerRow,
  LayerPagesRepo,
  LayersRepo,
} from '../db/repos/page_state.repo';
import type { DocumentHead } from './DocumentService';

export interface LayerStateServiceOptions {
  documentPages: DocumentPagesRepo;
  layers: LayersRepo;
  layerPages: LayerPagesRepo;
}

export type MutationImpactKind = AnnotationMutationKind;

/**
 * Durable authority for cloud/CDN page state.
 *
 * Worker sessions are still responsible for PDF parsing/mutation. This
 * service owns the durable DB-backed page state used by manifests and CDN
 * version checks; `CloudRevisionBridge` owns worker/cloud token translation.
 */
export class LayerStateService {
  private readonly documentPages: DocumentPagesRepo;
  private readonly layers: LayersRepo;
  private readonly layerPages: LayerPagesRepo;

  constructor(opts: LayerStateServiceOptions) {
    this.documentPages = opts.documentPages;
    this.layers = opts.layers;
    this.layerPages = opts.layerPages;
  }

  async ensureBasePages(
    docId: string,
    loadPages: () => Promise<PageState[]>,
  ): Promise<DurablePageRow[]> {
    const existing = await this.documentPages.findByDocument(docId);
    if (existing.length > 0) return existing;

    const observed = await loadPages();
    await this.documentPages.upsertForDocument(
      docId,
      observed.map((page) => ({
        pageObjectNumber: page.pageObjectNumber,
        pageIndex: page.pageIndex,
        hasWeakAnnotations: requireKnownWeakAnnotationBoolean(page),
      })),
    );
    return this.documentPages.findByDocument(docId);
  }

  async ensureLayerPagesFromBase(input: {
    layerId: string;
    docId: string;
  }): Promise<DurablePageRow[]> {
    const existing = await this.layerPages.findByLayer(input.layerId);
    if (existing.length > 0) return existing;
    const basePages = await this.documentPages.findByDocument(input.docId);
    await this.layerPages.snapshotImmutableBaseForLayer(input.layerId, basePages);
    return this.layerPages.findByLayer(input.layerId);
  }

  buildBaseManifest(head: DocumentHead, pages: DurablePageRow[]): DocumentManifest {
    return {
      docVersion: head.docVersion,
      baseSha: head.baseSha,
      pages: pages.map((page) => this.toManifestPage(`cloud:base:${head.id}`, page)),
    };
  }

  buildLayerManifest(
    docId: string,
    baseSha: string,
    layerName: string,
    layer: Pick<LayerRow, 'docVersion'>,
    pages: DurablePageRow[],
  ): DocumentManifest {
    return {
      docVersion: layer.docVersion,
      baseSha,
      pages: pages.map((page) =>
        this.toManifestPage(this.layerRevisionScopeId(docId, layerName), page),
      ),
    };
  }

  decorateBasePageState(docId: string, page: DurablePageRow): PageState {
    return this.toPageState(`cloud:base:${docId}`, page);
  }

  decorateBaseTextSnapshot(
    docId: string,
    page: DurablePageRow,
    snapshot: PageTextSnapshot,
  ): PageTextSnapshot {
    return {
      ...snapshot,
      pageState: this.decorateBasePageState(docId, page),
    };
  }

  decorateLayerPageState(docId: string, layerName: string, page: DurablePageRow): PageState {
    return this.toPageState(this.layerRevisionScopeId(docId, layerName), page);
  }

  layerRevisionScopeId(docId: string, layerName: string): string {
    return `cloud:layer:${docId}:${layerName}`;
  }

  mutationBumps(
    kind: MutationImpactKind,
    pageBefore: Pick<DurablePageRow, 'hasWeakAnnotations'>,
  ): {
    bumpLayerDocVersion: boolean;
    bumpAnnotationVersion: boolean;
    bumpContentVersion: boolean;
    bumpAnnotationGeneration: boolean;
    weakRefsInvalidated: boolean;
  } {
    const weakRefsInvalidated = invalidatesWeakIndexRefs(kind, pageBefore.hasWeakAnnotations);
    const shiftsAnnotationIndexes = kind === 'delete' || kind === 'move';
    return {
      bumpLayerDocVersion: true,
      bumpAnnotationVersion: changesAnnotationList(kind),
      bumpContentVersion: false,
      bumpAnnotationGeneration: shiftsAnnotationIndexes,
      weakRefsInvalidated,
    };
  }

  get repos(): {
    documentPages: DocumentPagesRepo;
    layers: LayersRepo;
    layerPages: LayerPagesRepo;
  } {
    return {
      documentPages: this.documentPages,
      layers: this.layers,
      layerPages: this.layerPages,
    };
  }

  private toManifestPage(scopeId: string, page: DurablePageRow): ManifestPage {
    const state = this.toPageState(scopeId, page);
    return {
      ...state,
      contentVersion: page.contentVersion,
      annotationVersion: page.annotationVersion,
      hasWeakAnnotations: page.hasWeakAnnotations,
    };
  }

  private toPageState(scopeId: string, page: DurablePageRow): PageState {
    return {
      pageObjectNumber: page.pageObjectNumber,
      pageIndex: page.pageIndex,
      revision: {
        docSessionId: scopeId,
        pageObjectNumber: page.pageObjectNumber,
        generation: page.annotationGeneration,
      },
      weakAnnotationState: {
        kind: 'known',
        hasAnyWeakAnnotations: page.hasWeakAnnotations,
      },
      hasAnyWeakAnnotations: page.hasWeakAnnotations,
    };
  }
}

function requireKnownWeakAnnotationBoolean(page: PageState): boolean {
  if (page.weakAnnotationState.kind !== 'known') {
    throw new Error(
      `cannot initialize durable manifest state from unknown weak annotation state for page ${page.pageObjectNumber}`,
    );
  }
  return page.weakAnnotationState.hasAnyWeakAnnotations;
}
