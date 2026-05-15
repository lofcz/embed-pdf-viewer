import { describe, expect, test } from 'vitest';
import type { PdfRuntimeModule, Ptr } from '@embedpdf/pdf-runtime';
import { BaseDocumentRegistry } from '../../engine-services/src/session/BaseDocumentRegistry';
import { DocumentSession } from '../../engine-services/src/session/DocumentSession';
import { openLayerDocument } from '../../engine-services/src/session/PdfDocumentOpener';

const ptr = (value: number): Ptr => BigInt(value) as Ptr;

function createFakeRuntime(): PdfRuntimeModule & {
  readonly calls: {
    closeDocuments: Ptr[];
    loadMemDocuments: Array<{ ptr: Ptr; size: number; password: string }>;
    loadMemBases: Array<{ ptr: Ptr; size: number; password: string }>;
    releaseBases: Ptr[];
    fileAccessClosed: number;
    order: string[];
  };
} {
  let nextPtr = 1000;
  const memory = new Map<string, number | bigint>();
  const calls = {
    closeDocuments: [] as Ptr[],
    loadMemDocuments: [] as Array<{ ptr: Ptr; size: number; password: string }>,
    loadMemBases: [] as Array<{ ptr: Ptr; size: number; password: string }>,
    releaseBases: [] as Ptr[],
    fileAccessClosed: 0,
    order: [] as string[],
  };

  const runtime = {
    kind: 'native',
    platform: 'test',
    calls,
    mem: {
      alloc: () => ptr(nextPtr++),
      free: () => undefined,
      readBytes: () => new Uint8Array(),
      writeBytes: () => undefined,
      readU8String: () => '',
      writeU8String: () => ptr(nextPtr++),
      readU16String: () => '',
      writeU16String: () => ptr(nextPtr++),
      peek: (address: Ptr, _kind: string, byteOffset = 0) =>
        memory.get(`${address}:${byteOffset}`) ?? 0,
      poke: (address: Ptr, _kind: string, value: number | bigint, byteOffset = 0) => {
        memory.set(`${address}:${byteOffset}`, value);
      },
    },
    cb: {
      register: () => ptr(nextPtr++),
      dispose: () => undefined,
    },
    fileAccess: {
      fromMemory: () => ({
        ptr: ptr(501),
        close: () => {
          calls.fileAccessClosed++;
          calls.order.push('file-access');
        },
      }),
      fromNodeFile: () => ({
        ptr: ptr(502),
        close: () => {
          calls.fileAccessClosed++;
          calls.order.push('file-access');
        },
      }),
    },
    fn: {
      FPDF_LoadMemDocument64: (dataPtr: Ptr, size: number, password: string) => {
        calls.loadMemDocuments.push({ ptr: dataPtr, size, password });
        return ptr(101);
      },
      FPDF_CloseDocument: (docPtr: Ptr) => {
        calls.closeDocuments.push(docPtr);
        calls.order.push('document');
      },
      EPDF_LoadMemBaseDocument64: (dataPtr: Ptr, size: number, password: string) => {
        calls.loadMemBases.push({ ptr: dataPtr, size, password });
        return ptr(201);
      },
      EPDF_LoadBaseDocument: () => ptr(202),
      EPDF_ReleaseBaseDocument: (basePtr: Ptr) => {
        calls.releaseBases.push(basePtr);
        calls.order.push('base');
      },
      EPDFLayer_OpenLayer: (_basePtr: Ptr, _accessPtr: Ptr, _password: string, statusPtr: Ptr) => {
        runtime.mem.poke(statusPtr, 'i32', 0);
        return ptr(301);
      },
      EPDFLayer_OpenLayerArtifact: (
        _basePtr: Ptr,
        _accessPtr: Ptr,
        _password: string,
        statusPtr: Ptr,
      ) => {
        runtime.mem.poke(statusPtr, 'i32', 0);
        return ptr(302);
      },
    },
    async destroy() {
      return undefined;
    },
  } as unknown as PdfRuntimeModule & { calls: typeof calls };

  return runtime;
}

describe('DocumentSession open ownership', () => {
  test('fat memory open preserves current FPDF_LoadMemDocument behavior', () => {
    const runtime = createFakeRuntime();
    const session = new DocumentSession(runtime);

    session.open(new Uint8Array([1, 2, 3]), 'pw');

    expect(session.kind).toBe('fat-memory');
    expect(runtime.calls.loadMemDocuments).toHaveLength(1);
    expect(runtime.calls.loadMemDocuments[0]).toMatchObject({ size: 3, password: 'pw' });

    session.close();

    expect(runtime.calls.closeDocuments).toEqual([ptr(101)]);
  });

  test('base registry shares one loaded memory base until the last release', () => {
    const runtime = createFakeRuntime();
    const registry = new BaseDocumentRegistry(runtime);

    const first = registry.acquireMemoryBase({
      key: 'base-a',
      bytes: new Uint8Array([1, 2]),
      password: null,
    });
    const second = registry.acquireMemoryBase({
      key: 'base-a',
      bytes: new Uint8Array([9, 9]),
      password: null,
    });

    expect(first.basePtr).toBe(second.basePtr);
    expect(runtime.calls.loadMemBases).toHaveLength(1);
    expect(registry.getRefCountForTesting('base-a')).toBe(2);

    first.release();
    expect(registry.getRefCountForTesting('base-a')).toBe(1);
    expect(runtime.calls.releaseBases).toEqual([]);

    second.release();
    expect(registry.getRefCountForTesting('base-a')).toBe(0);
    expect(runtime.calls.releaseBases).toEqual([ptr(201)]);
  });

  test('layer session closes document before artifact access and shared base', () => {
    const runtime = createFakeRuntime();
    const base = {
      key: 'base-a',
      basePtr: ptr(201),
      release: () => {
        runtime.calls.order.push('base-handle');
      },
    };

    const session = new DocumentSession(runtime);
    session.openFromHandle(
      openLayerDocument(runtime, base, { kind: 'artifact', bytes: new Uint8Array([7]) }),
    );

    expect(session.kind).toBe('layer');
    session.close();

    expect(runtime.calls.closeDocuments).toEqual([ptr(302)]);
    expect(runtime.calls.fileAccessClosed).toBe(1);
    expect(runtime.calls.order).toEqual(['document', 'file-access', 'base-handle']);
  });
});
