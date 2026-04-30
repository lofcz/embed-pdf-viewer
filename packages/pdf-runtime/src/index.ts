export type {
  Callback,
  CallbackFn,
  CallbackKind,
  CreatePdfRuntimeOptions,
  MemoryValueKind,
  PdfRuntimeCallbacks,
  PdfRuntimeMemory,
  PdfRuntimeModule,
  Ptr,
} from './core/pdf-runtime-module';
export type { PdfFunctions } from './core/pdf-functions.generated';
export { packageNameForTarget, resolveRuntimeTarget, type RuntimeTarget } from './core/platform';
export {
  toLegacyWrappedModule,
  toWrappedPdfiumModule,
  type LegacyWrappedPdfiumModule,
} from './legacy/to-wrapped-pdfium-module';

import type { CreatePdfRuntimeOptions, PdfRuntimeModule } from './core/pdf-runtime-module';
import { isNodeLike, resolveRuntimeTarget } from './core/platform';
import { createNativeRuntime } from './native/native-runtime';
import { createWasmRuntime } from './wasm/wasm-runtime';

export async function createPdfRuntime(
  opts: CreatePdfRuntimeOptions = {},
): Promise<PdfRuntimeModule> {
  const prefer = opts.prefer ?? 'auto';

  if (prefer === 'wasm' || !isNodeLike()) {
    return createWasmRuntime(opts);
  }

  const target = resolveRuntimeTarget();
  if (target && target !== 'wasm32') {
    try {
      return await createNativeRuntime(target);
    } catch (error) {
      if (prefer === 'native') throw error;
    }
  }

  return createWasmRuntime(opts);
}

export const init = createPdfRuntime;
