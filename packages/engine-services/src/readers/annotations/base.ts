import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';
import type {
  AnnotationBase,
  PageObjectNumber,
  RevisionToken,
} from '@embedpdf/engine-core/runtime';
import { pdfDateToIso } from '../pdf-date';
import { readAnnotationIdentity } from './identity';
import { readAnnotFlags, readAnnotRect, readAnnotString } from './util';

/**
 * Reads the wire shell every annotation DTO carries: identity, flags,
 * rect, contents, author, dates. No subtype-specific fields. The
 * per-subtype reader builds its DTO by extending this with its own
 * fields and `subtype: '...'` discriminator.
 */
export function readAnnotationBase(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  pageObjectNumber: PageObjectNumber,
  index: number,
  revision: RevisionToken,
): AnnotationBase {
  const identity = readAnnotationIdentity(fn, mem, annotPtr, pageObjectNumber, index, revision);
  const rect = readAnnotRect(fn, mem, annotPtr);
  const flags = readAnnotFlags(fn, annotPtr);
  const contents = readAnnotString(fn, mem, annotPtr, 'Contents');
  const author = readAnnotString(fn, mem, annotPtr, 'T');
  const createdRaw = readAnnotString(fn, mem, annotPtr, 'CreationDate');
  const modifiedRaw = readAnnotString(fn, mem, annotPtr, 'M');

  return {
    ref: identity.ref,
    pageObjectNumber,
    index,
    identityQuality: identity.identityQuality,
    nm: identity.nm,
    flags,
    rect,
    contents,
    author,
    created: createdRaw ? pdfDateToIso(createdRaw) : null,
    modified: modifiedRaw ? pdfDateToIso(modifiedRaw) : null,
  };
}
