/**
 * Public worker runtime entry point
 *
 * Worker-side building blocks for running PDFium inside a Web Worker.
 * Import this only from your worker script, never from the main thread.
 *
 * @packageDocumentation
 */

export { PdfiumEngineRunner } from './runner';
export type { FontFallbackConfig } from './font-fallback';
export { cdnFontConfig, createCdnFontConfig } from './cdn-fonts';

export const DEFAULT_PDFIUM_WASM_URL: string =
  'https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@__PDFIUM_VERSION__/dist/pdfium.wasm';
