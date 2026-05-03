import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';

/**
 * Read a key from the document's Info dictionary. Returns null if the key
 * does not exist, '' if it exists but is empty, otherwise the UTF-16 string.
 *
 * Mirrors the legacy engine's readMetaText (packages/engines/src/lib/pdfium/engine.ts:4568)
 * but written against the v3 PdfRuntimeModule shape.
 */
export function readMetaText(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  docPtr: Ptr,
  key: string,
): string | null {
  if (!fn.EPDF_HasMetaText(docPtr, key)) return null;

  // First call with len=0 to discover the required buffer size (UTF-16, including the trailing NUL).
  const len = fn.FPDF_GetMetaText(docPtr, key, 0n as Ptr, 0);
  if (len <= 0) return null;
  if (len === 2) return ''; // single UTF-16 NUL = empty string

  const buf = mem.alloc(len);
  try {
    const written = fn.FPDF_GetMetaText(docPtr, key, buf, len);
    if (written <= 0) return null;
    return mem.readU16String(buf);
  } finally {
    mem.free(buf);
  }
}
