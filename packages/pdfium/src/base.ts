import type { PdfiumModule } from './vendor/pdfium';
import type { PdfiumRuntimeMethods } from './vendor/runtime-methods';
import { functions } from './vendor/functions';

export type { PdfiumModule } from './vendor/pdfium';
export type { PdfiumRuntimeMethods } from './vendor/runtime-methods';

/**
 * Package-local PDFium WASM URL (resolved next to this module in `dist/`).
 * Bundlers that understand `import.meta.url` (Vite, Rollup, webpack 5+) emit a
 * correct asset URL — no CDN and no host `vite.config` hacks required.
 */
export const PDFIUM_WASM_URL: string = new URL('./pdfium.wasm', import.meta.url).href;

/**
 * @deprecated Use {@link PDFIUM_WASM_URL}. Kept as an alias for existing imports.
 */
export const DEFAULT_PDFIUM_WASM_URL: string = PDFIUM_WASM_URL;

/**
 * jsDelivr CDN URL for the WASM binary. Prefer {@link PDFIUM_WASM_URL} unless you
 * intentionally want a remote fallback.
 */
export const PDFIUM_WASM_CDN_URL: string =
  'https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@__PDFIUM_VERSION__/dist/pdfium.wasm';

/**
 * Name of JavaScript type
 */
export type Type = null | 'number' | 'string' | 'boolean' | null;

/**
 * Type of wrapped function
 */
export type CWrappedFunc<I extends readonly Type[], R extends Type> = (
  ...args: NamesToType<I>
) => NameToType<R>;

/**
 * Convert name to type
 */
export type NameToType<R extends Type> = R extends 'number'
  ? number
  : R extends 'string'
    ? string
    : R extends 'boolean'
      ? boolean
      : R extends null
        ? null
        : never;

/**
 * Convert array of names to JavaScript types
 */
export type NamesToType<T extends readonly Type[]> = T extends []
  ? []
  : T extends readonly [infer U extends Type]
    ? [NameToType<U>]
    : T extends readonly [infer U extends Type, ...infer Rest extends readonly Type[]]
      ? [NameToType<U>, ...NamesToType<Rest>]
      : [];

export type Functions = typeof functions;

export type Wrapped<T extends Record<string, readonly [readonly Type[], Type]>> = {
  [P in keyof T]: CWrappedFunc<T[P][0], T[P][1]>;
};

export type Methods = Wrapped<Functions>;

export type WrappedPdfiumModule = {
  pdfium: PdfiumModule & PdfiumRuntimeMethods;
} & Methods;

export async function createWrappedModule(
  pdfium: PdfiumModule & PdfiumRuntimeMethods,
): Promise<WrappedPdfiumModule> {
  const module: WrappedPdfiumModule = {
    pdfium,
  } as WrappedPdfiumModule;

  for (const key in functions) {
    const ident = key as keyof Functions;
    const args = functions[ident][0];
    const ret = functions[ident][1];
    // @ts-ignore
    module[ident] = pdfium.cwrap(key, ret, args);
  }

  return module;
}
