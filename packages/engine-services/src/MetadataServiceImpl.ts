import type { PdfRuntimeModule, Ptr } from '@embedpdf/pdf-runtime';
import type { DocumentMetadata } from '@embedpdf/engine-core/runtime';
import { throwIfAborted } from './abort';
import { readMetaText } from './readers/meta-text';
import { readTrapped } from './readers/trapped';
import { readAllCustomMeta } from './readers/custom-meta';
import { pdfDateToIso } from './readers/pdf-date';

/**
 * Synchronous, runtime-agnostic implementation of the metadata read.
 *
 * Lives in @embedpdf/engine-services so it can be reused unchanged by:
 *   - @embedpdf/engine-local (inside a browser Worker, WASM runtime)
 *   - @embedpdf/server       (inside a Node worker_thread, native runtime)
 *
 * Async-ness lives at the worker boundary, not here.
 */
export class MetadataServiceImpl {
  constructor(
    private readonly runtime: PdfRuntimeModule,
    private readonly docPtr: Ptr,
  ) {}

  read(signal: AbortSignal): DocumentMetadata {
    throwIfAborted(signal);
    const { fn, mem } = this.runtime;
    const doc = this.docPtr;

    const title = readMetaText(fn, mem, doc, 'Title');
    throwIfAborted(signal);
    const author = readMetaText(fn, mem, doc, 'Author');
    throwIfAborted(signal);
    const subject = readMetaText(fn, mem, doc, 'Subject');
    throwIfAborted(signal);
    const keywords = readMetaText(fn, mem, doc, 'Keywords');
    throwIfAborted(signal);
    const producer = readMetaText(fn, mem, doc, 'Producer');
    throwIfAborted(signal);
    const creator = readMetaText(fn, mem, doc, 'Creator');
    throwIfAborted(signal);
    const creationRaw = readMetaText(fn, mem, doc, 'CreationDate');
    throwIfAborted(signal);
    const modRaw = readMetaText(fn, mem, doc, 'ModDate');
    throwIfAborted(signal);
    const trapped = readTrapped(fn, doc);
    throwIfAborted(signal);
    const custom = readAllCustomMeta(fn, mem, doc);

    return {
      title,
      author,
      subject,
      keywords,
      producer,
      creator,
      created: creationRaw ? pdfDateToIso(creationRaw) : null,
      modified: modRaw ? pdfDateToIso(modRaw) : null,
      trapped,
      custom,
    };
  }
}
