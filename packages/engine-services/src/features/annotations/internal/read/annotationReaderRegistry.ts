import type {
  AnnotationBase,
  AnnotationDTO,
  AnnotationSubtype,
} from '@embedpdf/engine-core/runtime';
import { subtypeFromCode } from '@embedpdf/engine-core/runtime';
import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

import {
  readHighlight,
  readSquiggly,
  readStrikeout,
  readUnderline,
} from './readTextMarkupAnnotation';
import { readUnsupported } from './readUnsupportedAnnotation';

/**
 * One reader per `AnnotationSubtype`. Each reader produces the DTO type
 * the registry promised: `kinds/<subtype>/dto.ts`. Readers receive the
 * pre-built `AnnotationBase` (identity + flags + rect + dates) so each
 * implementation only has to materialise its own fields.
 *
 * The `unsupported` fallback preserves the raw subtype code so a future
 * reader landing for that subtype can replace it without a wire-format
 * version bump.
 */
export type AnnotationReader = (
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  annotPtr: Ptr,
  base: AnnotationBase,
  rawSubtypeCode: number,
) => AnnotationDTO;

const READER_BY_SUBTYPE: Partial<Record<AnnotationSubtype, AnnotationReader>> = {
  highlight: (fn, mem, annot, base) => readHighlight(fn, mem, annot, base),
  underline: (fn, mem, annot, base) => readUnderline(fn, mem, annot, base),
  squiggly: (fn, mem, annot, base) => readSquiggly(fn, mem, annot, base),
  strikeout: (fn, mem, annot, base) => readStrikeout(fn, mem, annot, base),
  unsupported: (fn, mem, annot, base, code) => readUnsupported(fn, mem, annot, base, code),
};

/**
 * Maps a PDFium subtype code onto the reader that should handle it.
 * Returns the `unsupported` reader for any subtype that doesn't have a
 * dedicated reader yet.
 */
export function pickReader(rawSubtypeCode: number): {
  reader: AnnotationReader;
  subtype: AnnotationSubtype;
} {
  const subtype = subtypeFromCode(rawSubtypeCode);
  const reader = READER_BY_SUBTYPE[subtype] ?? READER_BY_SUBTYPE.unsupported!;
  return { reader, subtype: reader === READER_BY_SUBTYPE.unsupported ? 'unsupported' : subtype };
}
