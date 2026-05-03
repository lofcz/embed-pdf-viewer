import type { PdfFunctions, PdfRuntimeMemory, Ptr } from '@embedpdf/pdf-runtime';
import { NULL_PTR } from '@embedpdf/pdf-runtime';
import { readMetaText } from './meta-text';

/**
 * Read the names of all keys in the document's Info dictionary.
 * customOnly = true returns only non-reserved (custom) keys, matching the
 * behavior of `getMetaKeyName` in the legacy engine.
 */
function readMetaKeyName(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  docPtr: Ptr,
  index: number,
  customOnly: boolean,
): string | null {
  const len = fn.EPDF_GetMetaKeyName(docPtr, index, customOnly, NULL_PTR, 0);
  if (!len || len <= 0) return null;
  const buf = mem.alloc(len);
  try {
    const written = fn.EPDF_GetMetaKeyName(docPtr, index, customOnly, buf, len);
    if (!written || written <= 0) return null;
    return mem.readU8String(buf);
  } finally {
    mem.free(buf);
  }
}

/**
 * Read all custom metadata key/value pairs from the document's Info
 * dictionary. The wire format guarantees `string` values, so absent keys
 * are dropped (rather than represented as null).
 *
 * Mirrors the legacy `readAllMeta` (engine.ts:4698) but tightens the type
 * to Record<string, string> for the wire format.
 */
export function readAllCustomMeta(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  docPtr: Ptr,
): Record<string, string> {
  const count = Number(fn.EPDF_GetMetaKeyCount(docPtr, true)) | 0;
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const key = readMetaKeyName(fn, mem, docPtr, i, true);
    if (!key) continue;
    const value = readMetaText(fn, mem, docPtr, key);
    if (value == null) continue;
    out[key] = value;
  }
  return out;
}
