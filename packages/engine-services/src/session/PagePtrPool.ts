import type { PdfRuntimeModule, Ptr } from '@embedpdf/pdf-runtime';
import type { PageObjectNumber } from '@embedpdf/engine-core/runtime';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core/runtime';

/**
 * Manages pagePtr lifetime for a single open `DocumentSession`.
 *
 * `acquire(pon)` returns a loaded pagePtr for the given PDF object number,
 * loading it via `EPDFDoc_LoadPageByObjectNumber` if not already in the
 * pool. `release(pon)` decrements the refcount and closes when it reaches
 * zero; `closeAll()` is called by `DocumentSession.close()`.
 *
 * The current implementation does not cache pagePtrs across calls (each
 * acquire+release pair loads and closes). A future slice can switch the
 * impl to LRU-cache pagePtrs for hot pages without changing callers.
 */
export class PagePtrPool {
  private readonly counts = new Map<PageObjectNumber, { ptr: Ptr; refs: number }>();

  constructor(
    private readonly runtime: PdfRuntimeModule,
    private readonly docPtr: Ptr,
  ) {}

  acquire(pageObjectNumber: PageObjectNumber): Ptr {
    const { fn } = this.runtime;
    const existing = this.counts.get(pageObjectNumber);
    if (existing) {
      existing.refs++;
      return existing.ptr;
    }
    const ptr = fn.EPDFDoc_LoadPageByObjectNumber(this.docPtr, pageObjectNumber);
    if (!ptr) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `no page with object number ${pageObjectNumber}`,
      );
    }
    this.counts.set(pageObjectNumber, { ptr, refs: 1 });
    return ptr;
  }

  release(pageObjectNumber: PageObjectNumber): void {
    const entry = this.counts.get(pageObjectNumber);
    if (!entry) return;
    entry.refs--;
    if (entry.refs <= 0) {
      this.runtime.fn.FPDF_ClosePage(entry.ptr);
      this.counts.delete(pageObjectNumber);
    }
  }

  closeAll(): void {
    const { fn } = this.runtime;
    for (const { ptr } of this.counts.values()) {
      fn.FPDF_ClosePage(ptr);
    }
    this.counts.clear();
  }
}
