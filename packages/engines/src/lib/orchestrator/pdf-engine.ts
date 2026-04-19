import {
  BatchProgress,
  Logger,
  NoopLogger,
  PdfEngine as IPdfEngine,
  PdfDocumentObject,
  PdfPageObject,
  PdfTask,
  PdfErrorReason,
  PdfFileUrl,
  PdfFile,
  PdfOpenDocumentUrlOptions,
  PdfOpenDocumentBufferOptions,
  PdfMetadataObject,
  PdfBookmarksObject,
  PdfBookmarkObject,
  PdfRenderPageOptions,
  PdfRenderThumbnailOptions,
  PdfRenderPageAnnotationOptions,
  PdfAnnotationObject,
  PdfTextRectObject,
  PdfSearchAllPagesOptions,
  SearchAllPagesResult,
  PdfPageSearchProgress,
  PdfAnnotationsProgress,
  PdfAttachmentObject,
  PdfAddAttachmentParams,
  PdfDocumentJavaScriptActionObject,
  PdfWidgetAnnoObject,
  PdfWidgetAnnoField,
  PdfWidgetJavaScriptActionObject,
  FormFieldValue,
  PdfFlattenPageOptions,
  PdfPageFlattenResult,
  PdfRedactTextOptions,
  Rect,
  PageTextSlice,
  PdfGlyphObject,
  PdfPageGeometry,
  PdfPageTextRuns,
  PdfPrintOptions,
  PdfEngineFeature,
  PdfEngineOperation,
  PdfSignatureObject,
  AnnotationCreateContext,
  Task,
  PdfErrorCode,
  SearchResult,
  CompoundTask,
  ImageDataLike,
  IPdfiumExecutor,
  AnnotationAppearanceMap,
  SignDocumentOptions,
  PdfSignatureHashAlgorithm,
  PreparedSignatureData,
  PdfDocumentVerification,
  PdfSignatureVerificationResult,
  PdfVerificationData,
  SignatureVerificationStatus,
  PdfSignatureIntegrityResult,
  PdfDocMDPComplianceStatus,
  PdfRevisionInterval,
} from '@embedpdf/models';
import {
  validatePreparedSignature,
  computeByteRanges,
  patchByteRange,
  hashByteRanges,
  patchContents,
  compareByteArrays,
} from './signing';
import { WorkerTaskQueue, Priority } from './task-queue';
import type { ImageDataConverter } from '../converters/types';
import { extractDetachedCmsDigestInfo } from './verification';

// Re-export for convenience
export type { ImageDataConverter } from '../converters/types';
export type { ImageDataLike, IPdfiumExecutor, BatchProgress } from '@embedpdf/models';

const LOG_SOURCE = 'PdfEngine';
const LOG_CATEGORY = 'Orchestrator';

export interface PdfEngineOptions<T> {
  /**
   * Image data converter (for encoding raw image data to Blob/other format)
   */
  imageConverter: ImageDataConverter<T>;
  /**
   * Fetch function for fetching remote URLs
   */
  fetcher?: typeof fetch;
  /**
   * Logger instance
   */
  logger?: Logger;
}

/**
 * PdfEngine orchestrator
 *
 * This is the "smart" layer that:
 * - Implements the PdfEngine interface
 * - Uses WorkerTaskQueue for priority-based task scheduling
 * - Orchestrates complex multi-page operations
 * - Handles image encoding with separate encoder pool
 * - Manages visibility-based task ranking
 */
export class PdfEngine<T = Blob> implements IPdfEngine<T> {
  private executor: IPdfiumExecutor;
  private workerQueue: WorkerTaskQueue;
  private logger: Logger;
  private options: PdfEngineOptions<T>;

  constructor(executor: IPdfiumExecutor, options: PdfEngineOptions<T>) {
    this.executor = executor;
    this.logger = options.logger ?? new NoopLogger();
    this.options = {
      imageConverter: options.imageConverter,
      fetcher:
        options.fetcher ??
        (typeof fetch !== 'undefined' ? (url, init) => fetch(url, init) : undefined),
      logger: this.logger,
    };

    // Create worker queue with single concurrency (PDFium is single-threaded)
    this.workerQueue = new WorkerTaskQueue({
      concurrency: 1,
      autoStart: true,
      logger: this.logger,
    });

    this.logger.debug(LOG_SOURCE, LOG_CATEGORY, 'PdfEngine orchestrator created');
  }

  /**
   * Split an array into chunks of a given size
   */
  private chunkArray<U>(items: U[], chunkSize: number): U[][] {
    const chunks: U[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private isDigestSupportedSubFilter(subFilter: string): boolean {
    return subFilter === 'adbe.pkcs7.detached' || subFilter === 'ETSI.CAdES.detached';
  }

  private async verifySignatureDigest(
    data: PdfVerificationData,
    signature: PdfVerificationData['signatures'][number],
  ): Promise<PdfSignatureIntegrityResult> {
    if (signature.byteRange.length !== 4) {
      return {
        status: SignatureVerificationStatus.INDETERMINATE,
        digestMatch: false,
        coversEntireRevision: false,
        message: 'Unsupported ByteRange length.',
      };
    }

    const coversEntireRevision =
      signature.revisionFileEnd !== undefined
        ? signature.byteRange[2] + signature.byteRange[3] === signature.revisionFileEnd
        : false;

    if (!this.isDigestSupportedSubFilter(signature.subFilter)) {
      return {
        status: SignatureVerificationStatus.INDETERMINATE,
        digestMatch: false,
        coversEntireRevision,
        message: `Digest verification for SubFilter "${signature.subFilter}" is not implemented yet.`,
      };
    }

    const cmsDigestInfo = extractDetachedCmsDigestInfo(signature.cmsBlob);
    if (!cmsDigestInfo) {
      return {
        status: SignatureVerificationStatus.INDETERMINATE,
        digestMatch: false,
        coversEntireRevision,
        message: 'Could not extract messageDigest from CMS.',
      };
    }

    const digest = await hashByteRanges(
      data.rawBytes,
      signature.byteRange as [number, number, number, number],
      cmsDigestInfo.algorithm,
    );
    const digestMatch = compareByteArrays(digest, cmsDigestInfo.digest);

    return {
      status: digestMatch ? SignatureVerificationStatus.VALID : SignatureVerificationStatus.INVALID,
      digestMatch,
      coversEntireRevision,
      algorithm: cmsDigestInfo.algorithm,
      ...(digestMatch ? {} : { message: 'ByteRange digest does not match CMS messageDigest.' }),
    };
  }

  // ========== IPdfEngine Implementation ==========

  isSupport(feature: PdfEngineFeature): PdfTask<PdfEngineOperation[]> {
    const task = new Task<PdfEngineOperation[], PdfErrorReason>();
    // PDFium supports all features
    task.resolve([
      PdfEngineOperation.Create,
      PdfEngineOperation.Read,
      PdfEngineOperation.Update,
      PdfEngineOperation.Delete,
    ]);
    return task;
  }

  destroy(): PdfTask<boolean> {
    const task = new Task<boolean, PdfErrorReason>();
    try {
      this.executor.destroy();
      // Clean up image converter resources (e.g., encoder worker pool)
      this.options.imageConverter.destroy?.();
      task.resolve(true);
    } catch (error) {
      task.reject({ code: PdfErrorCode.Unknown, message: String(error) });
    }
    return task;
  }

  openDocumentUrl(
    file: PdfFileUrl,
    options?: PdfOpenDocumentUrlOptions,
  ): PdfTask<PdfDocumentObject> {
    const task = new Task<PdfDocumentObject, PdfErrorReason>();

    // Handle fetch in main thread (not worker!)
    (async () => {
      try {
        if (!this.options.fetcher) {
          throw new Error('Fetcher is not set');
        }

        const response = await this.options.fetcher(file.url, options?.requestOptions);
        const arrayBuf = await response.arrayBuffer();

        const pdfFile: PdfFile = {
          id: file.id,
          content: arrayBuf,
        };

        // Then open in worker - use wait() to properly propagate task errors
        this.openDocumentBuffer(pdfFile, {
          password: options?.password,
          normalizeRotation: options?.normalizeRotation,
        }).wait(
          (doc) => task.resolve(doc),
          (error) => task.fail(error),
        );
      } catch (error) {
        // This only catches fetch errors (network issues, etc.)
        task.reject({ code: PdfErrorCode.Unknown, message: String(error) });
      }
    })();

    return task;
  }

  openDocumentBuffer(
    file: PdfFile,
    options?: PdfOpenDocumentBufferOptions,
  ): PdfTask<PdfDocumentObject> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.openDocumentBuffer(file, options),
        meta: { docId: file.id, operation: 'openDocumentBuffer' },
      },
      { priority: Priority.CRITICAL },
    );
  }

  getMetadata(doc: PdfDocumentObject): PdfTask<PdfMetadataObject> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getMetadata(doc),
        meta: { docId: doc.id, operation: 'getMetadata' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  setMetadata(doc: PdfDocumentObject, metadata: Partial<PdfMetadataObject>): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.setMetadata(doc, metadata),
        meta: { docId: doc.id, operation: 'setMetadata' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  getDocPermissions(doc: PdfDocumentObject): PdfTask<number> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getDocPermissions(doc),
        meta: { docId: doc.id, operation: 'getDocPermissions' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  getDocUserPermissions(doc: PdfDocumentObject): PdfTask<number> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getDocUserPermissions(doc),
        meta: { docId: doc.id, operation: 'getDocUserPermissions' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  getSignatures(doc: PdfDocumentObject): PdfTask<PdfSignatureObject[]> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getSignatures(doc),
        meta: { docId: doc.id, operation: 'getSignatures' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  getBookmarks(doc: PdfDocumentObject): PdfTask<PdfBookmarksObject> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getBookmarks(doc),
        meta: { docId: doc.id, operation: 'getBookmarks' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  setBookmarks(doc: PdfDocumentObject, bookmarks: PdfBookmarkObject[]): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.setBookmarks(doc, bookmarks),
        meta: { docId: doc.id, operation: 'setBookmarks' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  deleteBookmarks(doc: PdfDocumentObject): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.deleteBookmarks(doc),
        meta: { docId: doc.id, operation: 'deleteBookmarks' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  // ========== Rendering with Encoding ==========

  renderPage(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    options?: PdfRenderPageOptions,
  ): PdfTask<T> {
    return this.renderWithEncoding(
      () => this.executor.renderPageRaw(doc, page, options),
      options,
      doc.id,
      page.index,
      Priority.CRITICAL,
    );
  }

  renderPageRect(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    rect: Rect,
    options?: PdfRenderPageOptions,
  ): PdfTask<T> {
    return this.renderWithEncoding(
      () => this.executor.renderPageRect(doc, page, rect, options),
      options,
      doc.id,
      page.index,
      Priority.HIGH,
    );
  }

  // ========== Raw Rendering (no encoding) ==========

  renderPageRaw(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    options?: PdfRenderPageOptions,
  ): PdfTask<ImageDataLike> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.renderPageRaw(doc, page, options),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'renderPageRaw' },
      },
      { priority: Priority.HIGH },
    );
  }

  renderPageRectRaw(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    rect: Rect,
    options?: PdfRenderPageOptions,
  ): PdfTask<ImageDataLike> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.renderPageRect(doc, page, rect, options),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'renderPageRectRaw' },
      },
      { priority: Priority.HIGH },
    );
  }

  renderThumbnail(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    options?: PdfRenderThumbnailOptions,
  ): PdfTask<T> {
    return this.renderWithEncoding(
      () => this.executor.renderThumbnailRaw(doc, page, options),
      options,
      doc.id,
      page.index,
      Priority.MEDIUM,
    );
  }

  renderPageAnnotation(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    annotation: PdfAnnotationObject,
    options?: PdfRenderPageAnnotationOptions,
  ): PdfTask<T> {
    return this.renderWithEncoding(
      () => this.executor.renderPageAnnotationRaw(doc, page, annotation, options),
      options,
      doc.id,
      page.index,
      Priority.MEDIUM,
    );
  }

  renderPageAnnotations(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    options?: PdfRenderPageAnnotationOptions,
  ): PdfTask<AnnotationAppearanceMap<T>> {
    const resultTask = new Task<AnnotationAppearanceMap<T>, PdfErrorReason>();

    const renderHandle = this.workerQueue.enqueue(
      {
        execute: () => this.executor.renderPageAnnotationsRaw(doc, page, options),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'renderPageAnnotationsRaw' },
      },
      { priority: Priority.MEDIUM },
    );

    // Wire up abort: when resultTask is aborted, also abort the queue task
    const originalAbort = resultTask.abort.bind(resultTask);
    resultTask.abort = (reason) => {
      renderHandle.abort(reason);
      originalAbort(reason);
    };

    renderHandle.wait(
      (rawMap) => {
        if (resultTask.state.stage !== 0 /* Pending */) {
          return;
        }
        this.encodeAppearanceMap(rawMap, options, resultTask);
      },
      (error) => {
        if (resultTask.state.stage === 0 /* Pending */) {
          resultTask.fail(error);
        }
      },
    );

    return resultTask;
  }

  renderPageAnnotationsRaw(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    options?: PdfRenderPageAnnotationOptions,
  ): PdfTask<AnnotationAppearanceMap<ImageDataLike>> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.renderPageAnnotationsRaw(doc, page, options),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'renderPageAnnotationsRaw' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  /**
   * Helper to render and encode in two stages with priority queue
   */
  private renderWithEncoding(
    renderFn: () => PdfTask<ImageDataLike>,
    options?: PdfRenderPageOptions | PdfRenderThumbnailOptions | PdfRenderPageAnnotationOptions,
    docId?: string,
    pageIndex?: number,
    priority: Priority = Priority.CRITICAL,
  ): PdfTask<T> {
    const resultTask = new Task<T, PdfErrorReason>();

    // Step 1: Add HIGH/MEDIUM priority task to render raw bytes
    const renderHandle = this.workerQueue.enqueue(
      {
        execute: () => renderFn(),
        meta: { docId, pageIndex, operation: 'render' },
      },
      { priority },
    );

    // Wire up abort: when resultTask is aborted, also abort the queue task
    const originalAbort = resultTask.abort.bind(resultTask);
    resultTask.abort = (reason) => {
      renderHandle.abort(reason); // Cancel the queue task!
      originalAbort(reason);
    };

    renderHandle.wait(
      (rawImageData) => {
        // Check if resultTask was already aborted before encoding
        if (resultTask.state.stage !== 0 /* Pending */) {
          return;
        }
        this.encodeImage(rawImageData, options, resultTask);
      },
      (error) => {
        // Only forward error if resultTask is still pending
        if (resultTask.state.stage === 0 /* Pending */) {
          resultTask.fail(error);
        }
      },
    );

    return resultTask;
  }

  /**
   * Encode image using encoder pool or inline
   */
  private encodeImage(
    rawImageData: ImageDataLike,
    options: any,
    resultTask: Task<T, PdfErrorReason>,
  ): void {
    const imageType = options?.imageType ?? 'image/png';
    const quality = options?.quality;

    // Convert to plain object for encoding
    const plainImageData = {
      data: new Uint8ClampedArray(rawImageData.data),
      width: rawImageData.width,
      height: rawImageData.height,
    };

    this.options
      .imageConverter(() => plainImageData, imageType, quality)
      .then((result) => resultTask.resolve(result))
      .catch((error) => resultTask.reject({ code: PdfErrorCode.Unknown, message: String(error) }));
  }

  /**
   * Encode a full annotation appearance map to the output type T.
   */
  private encodeAppearanceMap(
    rawMap: AnnotationAppearanceMap<ImageDataLike>,
    options: PdfRenderPageAnnotationOptions | undefined,
    resultTask: Task<AnnotationAppearanceMap<T>, PdfErrorReason>,
  ): void {
    const imageType = options?.imageType ?? 'image/png';
    const quality = options?.imageQuality;

    const convertImage = (rawImageData: ImageDataLike): Promise<T> => {
      const plainImageData = {
        data: new Uint8ClampedArray(rawImageData.data),
        width: rawImageData.width,
        height: rawImageData.height,
      };
      return this.options.imageConverter(() => plainImageData, imageType, quality);
    };

    const jobs: Promise<void>[] = [];
    const encodedMap: AnnotationAppearanceMap<T> = {};
    const modes: Array<'normal' | 'rollover' | 'down'> = ['normal', 'rollover', 'down'];

    for (const [annotationId, appearances] of Object.entries(rawMap)) {
      const encodedAppearances: NonNullable<AnnotationAppearanceMap<T>[string]> = {};
      encodedMap[annotationId] = encodedAppearances;

      for (const mode of modes) {
        const appearance = appearances[mode];
        if (!appearance) continue;

        jobs.push(
          convertImage(appearance.data).then((encodedData) => {
            encodedAppearances[mode] = {
              data: encodedData,
              rect: appearance.rect,
            };
          }),
        );
      }
    }

    Promise.all(jobs)
      .then(() => {
        if (resultTask.state.stage === 0 /* Pending */) {
          resultTask.resolve(encodedMap);
        }
      })
      .catch((error) => {
        if (resultTask.state.stage === 0 /* Pending */) {
          resultTask.reject({ code: PdfErrorCode.Unknown, message: String(error) });
        }
      });
  }

  // ========== Annotations ==========

  getPageAnnotations(doc: PdfDocumentObject, page: PdfPageObject): PdfTask<PdfAnnotationObject[]> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getPageAnnotations(doc, page),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'getPageAnnotations' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  createPageAnnotation<A extends PdfAnnotationObject>(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    annotation: A,
    context?: AnnotationCreateContext<A>,
  ): PdfTask<string> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.createPageAnnotation(doc, page, annotation, context),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'createPageAnnotation' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  updatePageAnnotation(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    annotation: PdfAnnotationObject,
    options?: { regenerateAppearance?: boolean },
  ): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.updatePageAnnotation(doc, page, annotation, options),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'updatePageAnnotation' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  removePageAnnotation(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    annotation: PdfAnnotationObject,
  ): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.removePageAnnotation(doc, page, annotation),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'removePageAnnotation' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  /**
   * Get all annotations across all pages
   * Uses batched operations to reduce queue overhead
   */
  getAllAnnotations(
    doc: PdfDocumentObject,
  ): CompoundTask<Record<number, PdfAnnotationObject[]>, PdfErrorReason, PdfAnnotationsProgress> {
    // Chunk pages for batched processing
    const chunks = this.chunkArray(doc.pages, 500);

    this.logger.debug(
      LOG_SOURCE,
      LOG_CATEGORY,
      `getAllAnnotations: ${doc.pages.length} pages in ${chunks.length} chunks`,
    );

    // Create compound task for result aggregation
    const compound = new CompoundTask<
      Record<number, PdfAnnotationObject[]>,
      PdfErrorReason,
      PdfAnnotationsProgress
    >({
      aggregate: (results) => Object.assign({}, ...results),
    });

    // Create one task per chunk and wire up progress forwarding
    chunks.forEach((chunkPages, chunkIndex) => {
      const batchTask = this.workerQueue.enqueue(
        {
          execute: () => this.executor.getAnnotationsBatch(doc, chunkPages),
          meta: { docId: doc.id, operation: 'getAnnotationsBatch', chunkSize: chunkPages.length },
        },
        { priority: Priority.LOW },
      );

      // Forward batch progress (per-page) to compound task
      batchTask.onProgress((batchProgress: BatchProgress<PdfAnnotationObject[]>) => {
        compound.progress({
          page: batchProgress.pageIndex,
          result: batchProgress.result,
        });
      });

      compound.addChild(batchTask, chunkIndex);
    });

    compound.finalize();
    return compound;
  }

  getPageTextRects(doc: PdfDocumentObject, page: PdfPageObject): PdfTask<PdfTextRectObject[]> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getPageTextRects(doc, page),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'getPageTextRects' },
      },
      {
        priority: Priority.MEDIUM,
      },
    );
  }

  // ========== Search ==========

  /**
   * Search across all pages
   * Uses batched operations to reduce queue overhead
   */
  searchAllPages(
    doc: PdfDocumentObject,
    keyword: string,
    options?: PdfSearchAllPagesOptions,
  ): PdfTask<SearchAllPagesResult, PdfPageSearchProgress> {
    const flags = Array.isArray(options?.flags)
      ? options.flags.reduce((acc, flag) => acc | flag, 0)
      : (options?.flags ?? 0);

    // Chunk pages for batched processing
    const chunks = this.chunkArray(doc.pages, 25);

    this.logger.debug(
      LOG_SOURCE,
      LOG_CATEGORY,
      `searchAllPages: ${doc.pages.length} pages in ${chunks.length} chunks`,
    );

    // Create compound task for result aggregation
    const compound = new CompoundTask<SearchAllPagesResult, PdfErrorReason, PdfPageSearchProgress>({
      aggregate: (results) => {
        // Merge all batch results into a flat array
        const allResults = results.flatMap((batchResult: Record<number, SearchResult[]>) =>
          Object.values(batchResult).flat(),
        );
        return { results: allResults, total: allResults.length };
      },
    });

    // Create one task per chunk and wire up progress forwarding
    chunks.forEach((chunkPages, chunkIndex) => {
      const batchTask = this.workerQueue.enqueue(
        {
          execute: () => this.executor.searchBatch(doc, chunkPages, keyword, flags),
          meta: { docId: doc.id, operation: 'searchBatch', chunkSize: chunkPages.length },
        },
        { priority: Priority.LOW },
      );

      // Forward batch progress (per-page) to compound task
      batchTask.onProgress((batchProgress: BatchProgress<SearchResult[]>) => {
        compound.progress({
          page: batchProgress.pageIndex,
          results: batchProgress.result,
        });
      });

      compound.addChild(batchTask, chunkIndex);
    });

    compound.finalize();
    return compound;
  }

  // ========== Attachments ==========

  getAttachments(doc: PdfDocumentObject): PdfTask<PdfAttachmentObject[]> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getAttachments(doc),
        meta: { docId: doc.id, operation: 'getAttachments' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  addAttachment(doc: PdfDocumentObject, params: PdfAddAttachmentParams): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.addAttachment(doc, params),
        meta: { docId: doc.id, operation: 'addAttachment' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  removeAttachment(doc: PdfDocumentObject, attachment: PdfAttachmentObject): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.removeAttachment(doc, attachment),
        meta: { docId: doc.id, operation: 'removeAttachment' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  readAttachmentContent(
    doc: PdfDocumentObject,
    attachment: PdfAttachmentObject,
  ): PdfTask<ArrayBuffer> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.readAttachmentContent(doc, attachment),
        meta: { docId: doc.id, operation: 'readAttachmentContent' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  // ========== Forms ==========

  getDocumentJavaScriptActions(
    doc: PdfDocumentObject,
  ): PdfTask<PdfDocumentJavaScriptActionObject[]> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getDocumentJavaScriptActions(doc),
        meta: { docId: doc.id, operation: 'getDocumentJavaScriptActions' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  getPageAnnoWidgets(doc: PdfDocumentObject, page: PdfPageObject): PdfTask<PdfWidgetAnnoObject[]> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getPageAnnoWidgets(doc, page),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'getPageAnnoWidgets' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  getPageWidgetJavaScriptActions(
    doc: PdfDocumentObject,
    page: PdfPageObject,
  ): PdfTask<PdfWidgetJavaScriptActionObject[]> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getPageWidgetJavaScriptActions(doc, page),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'getPageWidgetJavaScriptActions' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  setFormFieldValue(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    annotation: PdfWidgetAnnoObject,
    value: FormFieldValue,
  ): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.setFormFieldValue(doc, page, annotation, value),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'setFormFieldValue' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  setFormFieldState(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    annotation: PdfWidgetAnnoObject,
    field: PdfWidgetAnnoField,
  ): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.setFormFieldState(doc, page, annotation, field),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'setFormFieldState' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  renameWidgetField(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    annotation: PdfWidgetAnnoObject,
    name: string,
  ): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.renameWidgetField(doc, page, annotation, name),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'renameWidgetField' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  shareWidgetField(
    doc: PdfDocumentObject,
    sourcePage: PdfPageObject,
    sourceAnnotation: PdfWidgetAnnoObject,
    targetPage: PdfPageObject,
    targetAnnotation: PdfWidgetAnnoObject,
  ): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () =>
          this.executor.shareWidgetField(
            doc,
            sourcePage,
            sourceAnnotation,
            targetPage,
            targetAnnotation,
          ),
        meta: {
          docId: doc.id,
          pageIndex: sourcePage.index,
          operation: 'shareWidgetField',
        },
      },
      { priority: Priority.MEDIUM },
    );
  }

  regenerateWidgetAppearances(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    annotationIds: string[],
  ): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.regenerateWidgetAppearances(doc, page, annotationIds),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'regenerateWidgetAppearances' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  flattenPage(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    options?: PdfFlattenPageOptions,
  ): PdfTask<PdfPageFlattenResult> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.flattenPage(doc, page, options),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'flattenPage' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  // ========== Text Operations ==========

  extractPages(doc: PdfDocumentObject, pageIndexes: number[]): PdfTask<ArrayBuffer> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.extractPages(doc, pageIndexes),
        meta: { docId: doc.id, pageIndexes: pageIndexes, operation: 'extractPages' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  createDocument(id: string): PdfTask<PdfDocumentObject> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.createDocument(id),
        meta: { docId: id, operation: 'createDocument' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  importPages(
    destDoc: PdfDocumentObject,
    srcDoc: PdfDocumentObject,
    srcPageIndices: number[],
    insertIndex?: number,
  ): PdfTask<PdfPageObject[]> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.importPages(destDoc, srcDoc, srcPageIndices, insertIndex),
        meta: { docId: destDoc.id, operation: 'importPages' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  deletePage(doc: PdfDocumentObject, pageIndex: number): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.deletePage(doc, pageIndex),
        meta: { docId: doc.id, operation: 'deletePage' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  extractText(doc: PdfDocumentObject, pageIndexes: number[]): PdfTask<string> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.extractText(doc, pageIndexes),
        meta: { docId: doc.id, pageIndexes: pageIndexes, operation: 'extractText' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  redactTextInRects(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    rects: Rect[],
    options?: PdfRedactTextOptions,
  ): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.redactTextInRects(doc, page, rects, options),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'redactTextInRects' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  applyRedaction(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    annotation: PdfAnnotationObject,
  ): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.applyRedaction(doc, page, annotation),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'applyRedaction' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  applyAllRedactions(doc: PdfDocumentObject, page: PdfPageObject): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.applyAllRedactions(doc, page),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'applyAllRedactions' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  flattenAnnotation(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    annotation: PdfAnnotationObject,
  ): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.flattenAnnotation(doc, page, annotation),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'flattenAnnotation' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  exportAnnotationAppearanceAsPdf(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    annotation: PdfAnnotationObject,
  ): PdfTask<ArrayBuffer> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.exportAnnotationAppearanceAsPdf(doc, page, annotation),
        meta: {
          docId: doc.id,
          pageIndex: page.index,
          operation: 'exportAnnotationAppearanceAsPdf',
        },
      },
      { priority: Priority.MEDIUM },
    );
  }

  exportAnnotationsAppearanceAsPdf(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    annotations: PdfAnnotationObject[],
  ): PdfTask<ArrayBuffer> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.exportAnnotationsAppearanceAsPdf(doc, page, annotations),
        meta: {
          docId: doc.id,
          pageIndex: page.index,
          operation: 'exportAnnotationsAppearanceAsPdf',
        },
      },
      { priority: Priority.MEDIUM },
    );
  }

  getTextSlices(doc: PdfDocumentObject, slices: PageTextSlice[]): PdfTask<string[]> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getTextSlices(doc, slices),
        meta: { docId: doc.id, slices: slices, operation: 'getTextSlices' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  getPageGlyphs(doc: PdfDocumentObject, page: PdfPageObject): PdfTask<PdfGlyphObject[]> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getPageGlyphs(doc, page),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'getPageGlyphs' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  getPageGeometry(doc: PdfDocumentObject, page: PdfPageObject): PdfTask<PdfPageGeometry> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getPageGeometry(doc, page),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'getPageGeometry' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  getPageTextRuns(doc: PdfDocumentObject, page: PdfPageObject): PdfTask<PdfPageTextRuns> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.getPageTextRuns(doc, page),
        meta: { docId: doc.id, pageIndex: page.index, operation: 'getPageTextRuns' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  // ========== Document Operations ==========

  merge(files: PdfFile[]): PdfTask<PdfFile> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.merge(files),
        meta: { docId: files.map((file) => file.id).join(','), operation: 'merge' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  mergePages(mergeConfigs: Array<{ docId: string; pageIndices: number[] }>): PdfTask<PdfFile> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.mergePages(mergeConfigs),
        meta: {
          docId: mergeConfigs.map((config) => config.docId).join(','),
          operation: 'mergePages',
        },
      },
      { priority: Priority.MEDIUM },
    );
  }

  preparePrintDocument(doc: PdfDocumentObject, options?: PdfPrintOptions): PdfTask<ArrayBuffer> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.preparePrintDocument(doc, options),
        meta: { docId: doc.id, operation: 'preparePrintDocument' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  saveAsCopy(doc: PdfDocumentObject): PdfTask<ArrayBuffer> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.saveAsCopy(doc),
        meta: { docId: doc.id, operation: 'saveAsCopy' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  closeDocument(doc: PdfDocumentObject): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.closeDocument(doc),
        meta: { docId: doc.id, operation: 'closeDocument' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  closeAllDocuments(): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.closeAllDocuments(),
        meta: { operation: 'closeAllDocuments' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  /**
   * {@inheritDoc @embedpdf/models!PdfEngine.setDocumentEncryption}
   */
  setDocumentEncryption(
    doc: PdfDocumentObject,
    userPassword: string,
    ownerPassword: string,
    allowedFlags: number,
  ): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () =>
          this.executor.setDocumentEncryption(doc, userPassword, ownerPassword, allowedFlags),
        meta: { docId: doc.id, operation: 'setDocumentEncryption' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  /**
   * {@inheritDoc @embedpdf/models!PdfEngine.removeEncryption}
   */
  removeEncryption(doc: PdfDocumentObject): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.removeEncryption(doc),
        meta: { docId: doc.id, operation: 'removeEncryption' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  /**
   * {@inheritDoc @embedpdf/models!PdfEngine.unlockOwnerPermissions}
   */
  unlockOwnerPermissions(doc: PdfDocumentObject, ownerPassword: string): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.unlockOwnerPermissions(doc, ownerPassword),
        meta: { docId: doc.id, operation: 'unlockOwnerPermissions' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  /**
   * {@inheritDoc @embedpdf/models!PdfEngine.isEncrypted}
   */
  isEncrypted(doc: PdfDocumentObject): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.isEncrypted(doc),
        meta: { docId: doc.id, operation: 'isEncrypted' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  /**
   * {@inheritDoc @embedpdf/models!PdfEngine.isOwnerUnlocked}
   */
  isOwnerUnlocked(doc: PdfDocumentObject): PdfTask<boolean> {
    return this.workerQueue.enqueue(
      {
        execute: () => this.executor.isOwnerUnlocked(doc),
        meta: { docId: doc.id, operation: 'isOwnerUnlocked' },
      },
      { priority: Priority.MEDIUM },
    );
  }

  verifyDocument(doc: PdfDocumentObject): PdfTask<PdfDocumentVerification> {
    const task = new Task<PdfDocumentVerification, PdfErrorReason>();

    (async () => {
      try {
        const data = await new Promise<PdfVerificationData>((resolve, reject) => {
          this.workerQueue
            .enqueue(
              {
                execute: () => this.executor.getVerificationData(doc),
                meta: { docId: doc.id, operation: 'getVerificationData' },
              },
              { priority: Priority.HIGH },
            )
            .wait(resolve, reject);
        });

        const signatures: PdfSignatureVerificationResult[] = [];
        for (const signature of data.signatures) {
          const integrity = await this.verifySignatureDigest(data, signature);
          const docMDPStatus = signature.docMDPStatus as PdfDocMDPComplianceStatus;
          signatures.push({
            signatureIndex: signature.signatureIndex,
            revisionIndex: signature.revisionIndex,
            subFilter: signature.subFilter,
            ...(signature.reason ? { reason: signature.reason } : {}),
            ...(signature.signingTime ? { signingTime: signature.signingTime } : {}),
            integrity,
            docMDP: {
              permission: signature.docMDPPermission,
              status: docMDPStatus,
              compliant: docMDPStatus === PdfDocMDPComplianceStatus.COMPLIANT,
            },
          });
        }

        const intervals: PdfRevisionInterval[] = data.intervals.map((interval) => ({
          olderRevisionIndex: interval.olderRevisionIndex,
          newerRevisionIndex: interval.newerRevisionIndex,
          entries: interval.entries,
        }));

        task.resolve({
          revisionCount: data.revisionCount,
          signatures,
          intervals,
          verifiedAt: new Date(),
        });
      } catch (error: any) {
        if (error && typeof error === 'object' && 'type' in error && 'reason' in error) {
          task.fail(error);
        } else {
          task.reject({ code: PdfErrorCode.Unknown, message: String(error) });
        }
      }
    })();

    return task;
  }

  reverifyDocument(doc: PdfDocumentObject): PdfTask<PdfDocumentVerification> {
    const task = new Task<PdfDocumentVerification, PdfErrorReason>();

    (async () => {
      try {
        const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
          this.workerQueue
            .enqueue(
              {
                execute: () => this.executor.saveAsCopy(doc),
                meta: { docId: doc.id, operation: 'saveAsCopy' },
              },
              { priority: Priority.HIGH },
            )
            .wait(resolve, reject);
        });

        const tempDoc = await new Promise<PdfDocumentObject>((resolve, reject) => {
          this.workerQueue
            .enqueue(
              {
                execute: () =>
                  this.executor.openDocumentBuffer(
                    { id: `${doc.id}__reverify__`, content: buffer },
                    { normalizeRotation: doc.normalizedRotation },
                  ),
                meta: { docId: doc.id, operation: 'openDocumentBuffer(reverify)' },
              },
              { priority: Priority.HIGH },
            )
            .wait(resolve, reject);
        });

        try {
          const result = await new Promise<PdfDocumentVerification>((resolve, reject) => {
            this.verifyDocument(tempDoc).wait(resolve, reject);
          });
          task.resolve(result);
        } finally {
          await new Promise<void>((resolve) => {
            this.workerQueue
              .enqueue(
                {
                  execute: () => this.executor.closeDocument(tempDoc),
                  meta: { docId: tempDoc.id, operation: 'closeDocument' },
                },
                { priority: Priority.HIGH },
              )
              .wait(
                () => resolve(),
                () => resolve(),
              );
          });
        }
      } catch (error: any) {
        if (error && typeof error === 'object' && 'type' in error && 'reason' in error) {
          task.fail(error);
        } else {
          task.reject({ code: PdfErrorCode.Unknown, message: String(error) });
        }
      }
    })();

    return task;
  }

  /**
   * {@inheritDoc @embedpdf/models!PdfEngine.signDocument}
   *
   * Orchestrates the full signing flow:
   * 1. Worker: prepare signature dict + incremental save + find offsets
   * 2. Main thread: compute byte ranges, hash, call user signer, patch buffer
   */
  signDocument(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    annotation: PdfWidgetAnnoObject,
    options: SignDocumentOptions,
  ): PdfTask<ArrayBuffer> {
    const task = new Task<ArrayBuffer, PdfErrorReason>();

    (async () => {
      try {
        // 1. Worker: prepare + incremental save + find offsets
        const prepared = await new Promise<PreparedSignatureData>((resolve, reject) => {
          this.workerQueue
            .enqueue(
              {
                execute: () =>
                  this.executor.prepareSignatureForSigning(doc, page, annotation, {
                    subFilter: options.subFilter,
                    contentsSize: options.contentsSize,
                    reason: options.reason,
                    location: options.location,
                    contactInfo: options.contactInfo,
                    certify: options.certify,
                  }),
                meta: { docId: doc.id, operation: 'prepareSignatureForSigning' },
              },
              { priority: Priority.HIGH },
            )
            .wait(
              (data) => resolve(data),
              (error) => reject(error),
            );
        });

        validatePreparedSignature(prepared);

        // 2. Main thread: compute actual byte ranges
        const ranges = computeByteRanges(
          prepared.buffer.byteLength,
          prepared.contentsOffset,
          prepared.contentsLength,
        );

        // 3. Main thread: patch ByteRange with actual values (before hashing)
        patchByteRange(prepared.buffer, prepared.byteRangeOffset, prepared.byteRangeLength, ranges);

        // 4. Main thread: hash the byte ranges via WebCrypto
        const algorithm = options.algorithm ?? PdfSignatureHashAlgorithm.SHA256;
        const digest = await hashByteRanges(prepared.buffer, ranges, algorithm);

        // 5. Main thread: call user's signer callback
        const cmsBlob = await options.signer.sign(digest, algorithm);

        // 6. Main thread: patch Contents with CMS blob
        patchContents(prepared.buffer, prepared.contentsOffset, prepared.contentsLength, cmsBlob);

        task.resolve(prepared.buffer);
      } catch (error: any) {
        if (error && typeof error === 'object' && 'type' in error && 'reason' in error) {
          task.fail(error);
        } else {
          task.reject({ code: PdfErrorCode.Unknown, message: String(error) });
        }
      }
    })();

    return task;
  }
}
