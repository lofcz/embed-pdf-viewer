import type { PdfRuntimeModule } from '@embedpdf/pdf-runtime';

const initialized = new WeakSet<PdfRuntimeModule>();

/**
 * Ensure FPDF_InitLibrary has been called for this runtime instance.
 * Safe to call multiple times.
 */
export function ensureInitialized(runtime: PdfRuntimeModule): void {
  if (initialized.has(runtime)) return;
  runtime.fn.FPDF_InitLibrary();
  initialized.add(runtime);
}

/**
 * Tear down the PDFium library bound to this runtime. Pair with the
 * runtime's own destroy() if the host wants the runtime gone too.
 */
export function destroyLibrary(runtime: PdfRuntimeModule): void {
  if (!initialized.has(runtime)) return;
  runtime.fn.FPDF_DestroyLibrary();
  initialized.delete(runtime);
}
