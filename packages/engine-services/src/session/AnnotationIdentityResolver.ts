import type { PdfRuntimeModule, Ptr } from '@embedpdf/pdf-runtime';
import { NULL_PTR } from '@embedpdf/pdf-runtime';
import type { AnnotationRef } from '@embedpdf/engine-core/runtime';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core/runtime';
import type { DocumentSession } from './DocumentSession';

/**
 * Resolves an `AnnotationRef` to a live `annotPtr` (and a borrowed
 * `pagePtr`). The caller MUST `release()` the page when done; the resolver
 * also returns a `closeAnnot()` helper that calls `FPDFPage_CloseAnnot` on
 * the annotPtr.
 *
 * Resolution order matches the wire spec:
 *   1. `objectNumber` -> `EPDFPage_GetAnnotByObjectNumber`
 *   2. `nm`           -> `EPDFPage_GetAnnotByName`
 *   3. `index`        -> `RevisionStore.validate(token)` then
 *                        `FPDFPage_GetAnnot(pagePtr, index)`
 *
 * Mutations (deferred slice) call this once before doing the actual work
 * to surface `InvalidReference` deterministically.
 */
export interface ResolvedAnnotation {
  pageObjectNumber: number;
  pagePtr: Ptr;
  annotPtr: Ptr;
  release: () => void;
}

export class AnnotationIdentityResolver {
  constructor(
    private readonly runtime: PdfRuntimeModule,
    private readonly session: DocumentSession,
  ) {}

  resolve(ref: AnnotationRef): ResolvedAnnotation {
    const { fn, mem } = this.runtime;
    const pool = this.session.pagePool();
    const pagePtr = pool.acquire(ref.pageObjectNumber);

    let annotPtr: Ptr = NULL_PTR;

    try {
      switch (ref.kind) {
        case 'objectNumber': {
          annotPtr = fn.EPDFPage_GetAnnotByObjectNumber(pagePtr, ref.annotObjectNumber);
          if (!annotPtr) {
            throw new EngineError(
              EngineErrorCode.InvalidReference,
              `no annotation with object number ${ref.annotObjectNumber} on page ${ref.pageObjectNumber}`,
            );
          }
          break;
        }
        case 'nm': {
          const namePtr = mem.writeU16String(ref.nm);
          try {
            annotPtr = fn.EPDFPage_GetAnnotByName(pagePtr, namePtr);
          } finally {
            mem.free(namePtr);
          }
          if (!annotPtr) {
            throw new EngineError(
              EngineErrorCode.InvalidReference,
              `no annotation with /NM '${ref.nm}' on page ${ref.pageObjectNumber}`,
            );
          }
          break;
        }
        case 'index': {
          this.session.validateRevision(ref.revision);
          annotPtr = fn.FPDFPage_GetAnnot(pagePtr, ref.index);
          if (!annotPtr) {
            throw new EngineError(
              EngineErrorCode.InvalidReference,
              `index ${ref.index} out of range on page ${ref.pageObjectNumber}`,
            );
          }
          break;
        }
      }
    } catch (err) {
      pool.release(ref.pageObjectNumber);
      throw err;
    }

    let released = false;
    const releaseAnnot = annotPtr;
    const release = (): void => {
      if (released) return;
      released = true;
      this.runtime.fn.FPDFPage_CloseAnnot(releaseAnnot);
      pool.release(ref.pageObjectNumber);
    };

    return {
      pageObjectNumber: ref.pageObjectNumber,
      pagePtr,
      annotPtr,
      release,
    };
  }
}
