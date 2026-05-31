import type {
  AnnotationBase,
  PageObjectNumber,
  RevisionToken,
} from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import { readAnnotFlags, readAnnotRect, readAnnotString } from './annotationReadPrimitives';
import { readAnnotationIdentity } from './readAnnotationIdentity';
import { readEmbedMetadata } from './readEmbedMetadata';
import { pdfDateToIso } from '../../../../shared/pdf-date';

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
  // EmbedPDF /EMBD_Metadata is optional; absent for legacy or anonymous
  // annotations. We spread the present fields into the DTO so the wire
  // never carries explicit `undefined` keys.
  const embd = readEmbedMetadata(fn, mem, annotPtr);

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
    ...(embd?.userId !== undefined ? { userId: embd.userId } : {}),
    ...(embd?.groupId !== undefined ? { groupId: embd.groupId } : {}),
    ...(embd?.createdBy !== undefined ? { createdBy: embd.createdBy } : {}),
    ...(embd?.updatedBy !== undefined ? { updatedBy: embd.updatedBy } : {}),
  };
}
