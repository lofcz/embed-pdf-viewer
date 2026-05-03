import type { PdfRuntimeModule } from '@embedpdf/pdf-runtime';
import type {
  AnnotationDTO,
  AnnotationListPageSnapshot,
  PageObjectNumber,
} from '@embedpdf/engine-core';
import type { DocumentSession } from '../../session/DocumentSession';
import { throwIfAborted } from '../../abort';
import { readAnnotationBase } from './base';
import { pickReader } from './registry';

/**
 * Per-page slow-path reader. Acquires a `pagePtr` from the
 * `PagePtrPool`, dispatches the same per-subtype catalog as the raw
 * reader, and releases the page on exit.
 *
 * Currently the dispatched readers do not use the `pagePtr` parameter
 * (text-markup is fully readable from the dict). Subtype readers that
 * need form/widget access (e.g. widget) will plug into this code path
 * as they land - the public DTO surface stays the same.
 */
export class FullAnnotationReader {
  constructor(
    private readonly runtime: PdfRuntimeModule,
    private readonly session: DocumentSession,
  ) {}

  list(pageObjectNumber: PageObjectNumber, signal: AbortSignal): AnnotationListPageSnapshot {
    throwIfAborted(signal);
    const { fn, mem } = this.runtime;
    const pool = this.session.pagePool();
    const pagePtr = pool.acquire(pageObjectNumber);

    try {
      const count = fn.FPDFPage_GetAnnotCount(pagePtr);
      const annotations: AnnotationDTO[] = [];
      let hasWeak = false;
      const revision = this.session.pageState(pageObjectNumber).revision;

      for (let i = 0; i < count; i++) {
        throwIfAborted(signal);
        const annotPtr = fn.FPDFPage_GetAnnot(pagePtr, i);
        if (!annotPtr) continue;
        try {
          const base = readAnnotationBase(fn, mem, annotPtr, pageObjectNumber, i, revision);
          const subtypeCode = fn.FPDFAnnot_GetSubtype(annotPtr);
          const { reader } = pickReader(subtypeCode);
          const dto = reader(fn, mem, annotPtr, base, subtypeCode);
          annotations.push(dto);
          if (dto.identityQuality === 'weak') hasWeak = true;
        } finally {
          fn.FPDFPage_CloseAnnot(annotPtr);
        }
      }

      this.session.recordWeakFlag(pageObjectNumber, hasWeak);
      const pageState = this.session.pageState(pageObjectNumber);
      return { pageState, annotations };
    } finally {
      pool.release(pageObjectNumber);
    }
  }
}
