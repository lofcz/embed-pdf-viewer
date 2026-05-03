import type { PdfRuntimeModule } from '@embedpdf/pdf-runtime';
import type {
  AnnotationDTO,
  AnnotationListPageSnapshot,
  AnnotationListSnapshotAllPages,
  PageObjectNumber,
} from '@embedpdf/engine-core';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core';
import type { DocumentSession } from '../../session/DocumentSession';
import { throwIfAborted } from '../../abort';
import { readAnnotationBase } from './base';
import { pickReader } from './registry';

/**
 * Whole-document and per-page raw read paths. Never acquires a pagePtr;
 * uses `EPDFPage_GetAnnotCountRaw` / `EPDFPage_GetAnnotRaw` /
 * `EPDFAnnot_GetObjectNumber` directly off the docPtr.
 *
 * Per-subtype dispatch is the same as the full reader, so the wire shape
 * `AnnotationDTO[]` is identical between raw and full read paths for the
 * subtypes that don't actually need a pagePtr to materialise their fields
 * (text-markup, plus all currently-typed subtypes).
 */
export class RawAnnotationReader {
  constructor(
    private readonly runtime: PdfRuntimeModule,
    private readonly session: DocumentSession,
  ) {}

  listAll(signal: AbortSignal): AnnotationListSnapshotAllPages {
    throwIfAborted(signal);
    this.session.ensureFullPageRegistry();
    const records = this.session.allRecords();
    const pages: AnnotationListPageSnapshot[] = [];
    for (const record of records) {
      throwIfAborted(signal);
      pages.push(this.listOne(record.pageObjectNumber, signal));
    }
    return { pages };
  }

  listOne(pageObjectNumber: PageObjectNumber, signal: AbortSignal): AnnotationListPageSnapshot {
    throwIfAborted(signal);
    const { fn, mem } = this.runtime;
    const docPtr = this.session.requireDocPtr();
    const record = this.session.recordByObjectNumber(pageObjectNumber);

    const count = fn.EPDFPage_GetAnnotCountRaw(docPtr, record.pageIndex);
    if (count < 0) {
      throw new EngineError(
        EngineErrorCode.Unknown,
        `EPDFPage_GetAnnotCountRaw returned ${count} for page ${pageObjectNumber}`,
      );
    }

    const annotations: AnnotationDTO[] = [];
    let hasWeak = false;
    const revision = this.session.pageState(pageObjectNumber).revision;

    for (let i = 0; i < count; i++) {
      throwIfAborted(signal);
      const annotPtr = fn.EPDFPage_GetAnnotRaw(docPtr, record.pageIndex, i);
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
  }
}
