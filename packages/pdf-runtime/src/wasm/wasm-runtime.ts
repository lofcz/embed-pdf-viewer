import type {
  Callback,
  CallbackFn,
  CallbackKind,
  CreatePdfRuntimeOptions,
  MemoryValueKind,
  PdfRuntimeCallbacks,
  PdfRuntimeMemory,
  PdfRuntimeModule,
  Ptr,
} from '../core/pdf-runtime-module';
import { pdfFunctionSignatures } from '../core/pdf-functions.generated';

type EmscriptenModule = Record<string, any> & {
  HEAPU8: Uint8Array;
  _malloc?: (bytes: number) => number;
  _free?: (ptr: number) => void;
  cwrap?: (
    name: string,
    result: string | null,
    params: readonly string[],
  ) => (...args: unknown[]) => unknown;
  addFunction?: (fn: (...args: unknown[]) => unknown, signature?: string) => number;
  removeFunction?: (ptr: number) => void;
  getValue?: (ptr: number, type: string) => number;
  setValue?: (ptr: number, value: number | bigint, type: string) => void;
  UTF8ToString?: (ptr: number) => string;
  UTF16ToString?: (ptr: number) => string;
  stringToUTF8?: (str: string, ptr: number, maxBytes: number) => void;
  stringToUTF16?: (str: string, ptr: number, maxBytes: number) => void;
};

function toPtr(value: number | bigint): Ptr {
  return BigInt(value) as Ptr;
}

function toNumber(ptr: Ptr | Callback): number {
  return Number(ptr);
}

function wasmValueKind(kind: MemoryValueKind): string {
  switch (kind) {
    case 'i8':
      return 'i8';
    case 'i16':
      return 'i16';
    case 'i32':
      return 'i32';
    case 'i64':
      return 'i64';
    case 'f32':
      return 'float';
    case 'f64':
      return 'double';
    case 'ptr':
      return '*';
  }
}

function createWasmMemory(module: EmscriptenModule): PdfRuntimeMemory {
  const malloc = module._malloc ?? module.wasmExports?.malloc;
  const free = module._free ?? module.wasmExports?.free;

  if (!malloc || !free) {
    throw new Error('WASM runtime does not expose malloc/free');
  }

  return {
    alloc(bytes) {
      return toPtr(malloc(bytes));
    },
    free(ptr) {
      free(toNumber(ptr));
    },
    readBytes(ptr, len) {
      return module.HEAPU8.slice(toNumber(ptr), toNumber(ptr) + len);
    },
    writeBytes(ptr, data) {
      module.HEAPU8.set(data, toNumber(ptr));
    },
    readU8String(ptr) {
      return module.UTF8ToString?.(toNumber(ptr)) ?? '';
    },
    writeU8String(str) {
      const bytes = new TextEncoder().encode(`${str}\0`);
      const ptr = toPtr(malloc(bytes.length));
      module.HEAPU8.set(bytes, toNumber(ptr));
      return ptr;
    },
    readU16String(ptr) {
      return module.UTF16ToString?.(toNumber(ptr)) ?? '';
    },
    writeU16String(str) {
      const bytes = (str.length + 1) * 2;
      const ptr = toPtr(malloc(bytes));
      module.stringToUTF16?.(str, toNumber(ptr), bytes);
      return ptr;
    },
    peek(ptr, kind) {
      return module.getValue?.(toNumber(ptr), wasmValueKind(kind)) ?? 0;
    },
    poke(ptr, kind, value) {
      module.setValue?.(toNumber(ptr), value, wasmValueKind(kind));
    },
  };
}

function createWasmCallbacks(module: EmscriptenModule): PdfRuntimeCallbacks {
  return {
    register(_kind: CallbackKind, fn: CallbackFn): Callback {
      if (!module.addFunction) throw new Error('WASM runtime does not expose addFunction');
      return BigInt(module.addFunction(fn)) as Callback;
    },
    dispose(callback) {
      module.removeFunction?.(toNumber(callback));
    },
  };
}

function createWasmFunctions(
  module: EmscriptenModule,
): Record<string, (...args: unknown[]) => unknown> {
  const out: Record<string, (...args: unknown[]) => unknown> = {};
  for (const [name, signature] of Object.entries(pdfFunctionSignatures)) {
    if (module.cwrap) {
      out[name] = module.cwrap(name, signature.result, signature.params);
    } else if (typeof module[`_${name}`] === 'function') {
      out[name] = module[`_${name}`].bind(module);
    }
  }
  return out;
}

export async function createWasmRuntime(
  opts: CreatePdfRuntimeOptions = {},
): Promise<PdfRuntimeModule> {
  const wasmPackage = await import('@embedpdf/pdf-runtime-wasm32');
  const createModule = (wasmPackage.default ?? wasmPackage) as (
    opts?: Record<string, unknown>,
  ) => Promise<EmscriptenModule>;
  const module = await createModule(opts.wasm);

  return {
    kind: 'wasm',
    platform: 'wasm32',
    mem: createWasmMemory(module),
    cb: createWasmCallbacks(module),
    fn: createWasmFunctions(module),
    async destroy() {
      module._free = module._free;
    },
  };
}
