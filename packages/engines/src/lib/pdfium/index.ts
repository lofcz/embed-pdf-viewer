export * from './engine';
export * from './helper';
export * from '../converters/types';
export * from '../converters/browser';
export * from '../orchestrator/pdf-engine';
export * from './font-fallback';
export * from './cdn-fonts';

// Export web factory functions (avoid ambiguous exports)
export { createPdfiumEngine as createPdfiumDirectEngine } from './web/direct-engine';
export { createPdfiumEngine as createPdfiumWorkerEngine } from './web/worker-engine';
export type { CreatePdfiumEngineOptions } from './web/direct-engine';
export { mergeFontFallbacks } from './merge-font-fallbacks';

export {
  PDFIUM_WASM_URL,
  DEFAULT_PDFIUM_WASM_URL,
  PDFIUM_WASM_CDN_URL,
} from '@embedpdf/pdfium';
