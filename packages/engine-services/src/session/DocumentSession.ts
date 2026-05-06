import type { PdfRuntimeModule, Ptr } from '@embedpdf/pdf-runtime';
import type { PageObjectNumber, PageState, RevisionToken } from '@embedpdf/engine-core';
import { EngineError, EngineErrorCode, isValidPageObjectNumber } from '@embedpdf/engine-core';
import { MetadataServiceImpl } from '../MetadataServiceImpl';
import type { PageRecord } from './PageRecord';
import { PagePtrPool } from './PagePtrPool';
import { RevisionStore } from './RevisionStore';

/**
 * Owns the lifecycle of a single open PDFium document and the v3
 * identity machinery: page registry (pageObjectNumber <-> pageIndex),
 * `RevisionStore` (per-page generation counters), and `PagePtrPool`
 * (refcounted pagePtr access).
 *
 * Both the local browser Worker and the server worker_thread instantiate
 * this exactly the same way; the only thing that differs is the
 * underlying PdfRuntimeModule (WASM vs native).
 */
export class DocumentSession {
  private docPtr: Ptr | null = null;
  private dataPtr: Ptr | null = null;
  private readonly _sessionId: string;

  /** pon -> record */
  private readonly recordsByObjectNumber = new Map<PageObjectNumber, PageRecord>();
  /** pageIndex -> record */
  private readonly recordsByIndex = new Map<number, PageRecord>();
  private fullyEnumerated = false;

  /** Annotations on the page have at least one weak (no objectNumber, no NM). */
  private readonly weakFlags = new Map<PageObjectNumber, boolean>();

  private revisions: RevisionStore | null = null;
  private pages: PagePtrPool | null = null;

  constructor(
    private readonly runtime: PdfRuntimeModule,
    sessionId?: string,
  ) {
    this._sessionId = sessionId ?? generateSessionId();
  }

  get sessionId(): string {
    return this._sessionId;
  }

  isOpen(): boolean {
    return this.docPtr !== null;
  }

  open(bytes: Uint8Array, password: string | null = null): void {
    if (this.docPtr) {
      throw new EngineError(EngineErrorCode.InvalidArg, 'document already open');
    }
    const { mem, fn } = this.runtime;
    const dataPtr = mem.alloc(bytes.byteLength);
    mem.writeBytes(dataPtr, bytes);
    const docPtr = fn.FPDF_LoadMemDocument(dataPtr, bytes.byteLength, password ?? '');
    if (!docPtr) {
      mem.free(dataPtr);
      throw new EngineError(EngineErrorCode.DocOpenFailed, 'failed to open document');
    }
    this.docPtr = docPtr;
    this.dataPtr = dataPtr;
    this.revisions = new RevisionStore(this._sessionId);
    this.pages = new PagePtrPool(runtimePagesAreSafe(this.runtime), docPtr);
  }

  metadata(): MetadataServiceImpl {
    const ptr = this.requireDocPtr();
    return new MetadataServiceImpl(this.runtime, ptr);
  }

  /** Number of pages in the document. */
  pageCount(): number {
    return this.runtime.fn.FPDF_GetPageCount(this.requireDocPtr());
  }

  /**
   * Lazily enumerate every page and cache (pageObjectNumber, pageIndex).
   * Necessary before `listRawAll()` and any pon -> pageIndex resolution.
   */
  ensureFullPageRegistry(): void {
    if (this.fullyEnumerated) return;
    const { fn } = this.runtime;
    const docPtr = this.requireDocPtr();
    const count = fn.FPDF_GetPageCount(docPtr);
    for (let i = 0; i < count; i++) {
      if (this.recordsByIndex.has(i)) continue;
      const pagePtr = fn.FPDF_LoadPage(docPtr, i);
      if (!pagePtr) {
        throw new EngineError(EngineErrorCode.NotFound, `failed to load page at index ${i}`);
      }
      try {
        const pon = fn.EPDFPage_GetObjectNumber(pagePtr);
        if (!isValidPageObjectNumber(pon)) {
          // Spec violation: ISO 32000-1 §7.7.3.3 requires every
          // /Page to be referenced indirectly from the /Pages tree.
          // PDFium's loader is permissive enough to surface direct
          // page dicts from broken generators, but the engine's
          // identity model requires a real indirect object number,
          // so we refuse the document here with a clear, actionable
          // error rather than silently routing through a weak
          // identity path.
          throw new EngineError(
            EngineErrorCode.MalformedPdf,
            `page at index ${i} is a direct (non-indirect) PDF object; the engine requires every page to have a stable indirect object number`,
            { details: { pageIndex: i, pon } },
          );
        }
        const record: PageRecord = { pageObjectNumber: pon, pageIndex: i };
        this.recordsByIndex.set(i, record);
        this.recordsByObjectNumber.set(pon, record);
      } finally {
        fn.FPDF_ClosePage(pagePtr);
      }
    }
    this.fullyEnumerated = true;
  }

  /** Lookup; populates the cache for one page only on cache miss. */
  recordByObjectNumber(pageObjectNumber: PageObjectNumber): PageRecord {
    const cached = this.recordsByObjectNumber.get(pageObjectNumber);
    if (cached) return cached;

    // Probe the doc by loading the page directly via its object number;
    // walk the index range to find which page index it lives at.
    const { fn } = this.runtime;
    const docPtr = this.requireDocPtr();
    const probePtr = fn.EPDFDoc_LoadPageByObjectNumber(docPtr, pageObjectNumber);
    if (!probePtr) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `no page with object number ${pageObjectNumber}`,
      );
    }
    fn.FPDF_ClosePage(probePtr);

    // Now we know the page exists; fall back to a full enumeration to get
    // its display index. This is O(pageCount) once per session.
    this.ensureFullPageRegistry();
    const found = this.recordsByObjectNumber.get(pageObjectNumber);
    if (!found) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `page with object number ${pageObjectNumber} present but unindexable`,
      );
    }
    return found;
  }

  recordByIndex(pageIndex: number): PageRecord {
    if (this.recordsByIndex.has(pageIndex)) return this.recordsByIndex.get(pageIndex)!;
    this.ensureFullPageRegistry();
    const found = this.recordsByIndex.get(pageIndex);
    if (!found) {
      throw new EngineError(EngineErrorCode.NotFound, `no page at index ${pageIndex}`);
    }
    return found;
  }

  /** All page records, in display order. Forces full enumeration. */
  allRecords(): PageRecord[] {
    this.ensureFullPageRegistry();
    return Array.from(this.recordsByIndex.entries())
      .sort(([a], [b]) => a - b)
      .map(([, r]) => r);
  }

  /**
   * Drop the cached `pageIndex <-> pageObjectNumber` mapping and force a
   * fresh enumeration on next access. Called by `DocumentPagesMutator`
   * after `FPDF_MovePages` shuffles page positions; we keep
   * `weakFlags` and per-page revision counters intact, both of which are
   * keyed by durable `pageObjectNumber` and survive a page reorder.
   */
  refreshPageRegistry(): void {
    this.recordsByIndex.clear();
    this.recordsByObjectNumber.clear();
    this.fullyEnumerated = false;
    this.ensureFullPageRegistry();
  }

  /** Per-page state envelope used by every read/mutation result. */
  pageState(pageObjectNumber: PageObjectNumber): PageState {
    const record = this.recordByObjectNumber(pageObjectNumber);
    return {
      pageObjectNumber,
      pageIndex: record.pageIndex,
      revision: this.requireRevisions().token(pageObjectNumber),
      hasAnyWeakAnnotations: this.weakFlags.get(pageObjectNumber) ?? false,
    };
  }

  /** Set by readers as they discover whether a page has weak annotations. */
  recordWeakFlag(pageObjectNumber: PageObjectNumber, hasWeak: boolean): void {
    this.weakFlags.set(pageObjectNumber, hasWeak);
  }

  /** Bump and return the new revision token; called by mutation paths. */
  bumpRevision(pageObjectNumber: PageObjectNumber): RevisionToken {
    return this.requireRevisions().bump(pageObjectNumber);
  }

  validateRevision(token: RevisionToken): void {
    this.requireRevisions().validate(token);
  }

  pagePool(): PagePtrPool {
    if (!this.pages) {
      throw new EngineError(EngineErrorCode.DocNotOpen, 'document is not open');
    }
    return this.pages;
  }

  requireDocPtr(): Ptr {
    if (!this.docPtr) {
      throw new EngineError(EngineErrorCode.DocNotOpen, 'document is not open');
    }
    return this.docPtr;
  }

  close(): void {
    const { mem, fn } = this.runtime;
    if (this.pages) {
      this.pages.closeAll();
      this.pages = null;
    }
    if (this.docPtr) {
      fn.FPDF_CloseDocument(this.docPtr);
      this.docPtr = null;
    }
    if (this.dataPtr) {
      mem.free(this.dataPtr);
      this.dataPtr = null;
    }
    this.revisions = null;
    this.recordsByIndex.clear();
    this.recordsByObjectNumber.clear();
    this.weakFlags.clear();
    this.fullyEnumerated = false;
  }

  private requireRevisions(): RevisionStore {
    if (!this.revisions) {
      throw new EngineError(EngineErrorCode.DocNotOpen, 'document is not open');
    }
    return this.revisions;
  }
}

function runtimePagesAreSafe(rt: PdfRuntimeModule): PdfRuntimeModule {
  // Tiny indirection retained as a hook for future per-runtime guard
  // logic (e.g. asserting native vs wasm capabilities).
  return rt;
}

function generateSessionId(): string {
  // Lightweight id; no crypto dependency. Sufficient for the docSessionId
  // bleed-over check (which is local-process anyway).
  return `sess_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}
