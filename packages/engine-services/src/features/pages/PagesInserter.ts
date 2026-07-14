import {
  EngineError,
  EngineErrorCode,
  type PageInsertResult,
  type PageObjectNumber,
} from '@embedpdf/engine-core/runtime';
import type { PdfRuntimeModule } from '@embedpdf/pdf-runtime';

import { PagesReader } from './PagesReader';
import type { DocumentSession } from '../../document-session/DocumentSession';
import { throwIfAborted } from '../../shared/abort';

/**
 * Insert every page of a standalone PDF into the session document. A
 * structural MUTATION (like move/delete): the source bytes are loaded as a
 * throwaway PDFium document, `FPDF_ImportPagesByIndex` deep-copies its
 * pages in at `destIndex`, and the page registry is rebuilt. Pre-existing
 * pages keep their identity and `RevisionToken`s; the inserted copies get
 * fresh object numbers, resolved from the post-insert registry.
 */
export class PagesInserter {
  constructor(
    private readonly runtime: PdfRuntimeModule,
    private readonly session: DocumentSession,
  ) {}

  insert(bytes: ArrayBuffer, destIndex: number | undefined, signal: AbortSignal): PageInsertResult {
    throwIfAborted(signal);
    if (bytes.byteLength === 0) {
      throw new EngineError(EngineErrorCode.InvalidArg, 'pages.insert requires non-empty bytes');
    }

    const { fn, mem } = this.runtime;
    const destPtr = this.session.requireDocPtr();
    const beforeCount = fn.FPDF_GetPageCount(destPtr);
    const at = destIndex ?? beforeCount;
    if (!Number.isInteger(at) || at < 0 || at > beforeCount) {
      throw new EngineError(
        EngineErrorCode.InvalidArg,
        `pages.insert destIndex ${at} out of range [0, ${beforeCount}]`,
      );
    }

    // The source buffer must stay alive until the temp document closes
    // (same rule as the stamp /AP path in writeStampAnnotation).
    const dataPtr = mem.alloc(bytes.byteLength);
    let insertedCount = 0;
    try {
      mem.writeBytes(dataPtr, new Uint8Array(bytes));
      const srcPtr = fn.FPDF_LoadMemDocument(dataPtr, bytes.byteLength, '');
      if (!srcPtr) {
        throw new EngineError(
          EngineErrorCode.MalformedPdf,
          'pages.insert source PDF could not be opened',
        );
      }
      try {
        insertedCount = fn.FPDF_GetPageCount(srcPtr);
        if (insertedCount <= 0) {
          throw new EngineError(EngineErrorCode.InvalidArg, 'pages.insert source PDF has no pages');
        }
        // Null index array + count 0 = "import every page", in order.
        if (!fn.FPDF_ImportPagesByIndex(destPtr, srcPtr, 0, 0, at)) {
          throw new EngineError(
            EngineErrorCode.Unknown,
            `FPDF_ImportPagesByIndex rejected the insert at index ${at}`,
          );
        }
      } finally {
        fn.FPDF_CloseDocument(srcPtr);
      }
    } finally {
      mem.free(dataPtr);
    }

    // Page count and order changed; rebuild the index<->pon map. Existing
    // pages' revisions and weak-flag bookkeeping stay put (keyed by pon).
    this.session.refreshPageRegistry();

    const layout = new PagesReader(this.runtime, this.session).read(signal);
    const insertedPageObjectNumbers: PageObjectNumber[] = layout.pages
      .slice(at, at + insertedCount)
      .map((page) => page.pageObjectNumber);
    return { insertedPageObjectNumbers, layout, cache: null };
  }
}
