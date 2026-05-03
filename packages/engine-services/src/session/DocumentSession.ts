import type { PdfRuntimeModule, Ptr } from '@embedpdf/pdf-runtime';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core';
import { MetadataServiceImpl } from '../MetadataServiceImpl';

const NULL_PTR = 0n as Ptr;

/**
 * Owns the lifecycle of a single open PDFium document: the docPtr and the
 * pinned data buffer. Both the local browser Worker and the server
 * worker_thread instantiate this exactly the same way; the only thing
 * that differs is the underlying PdfRuntimeModule (WASM vs native).
 */
export class DocumentSession {
  private docPtr: Ptr | null = null;
  private dataPtr: Ptr | null = null;

  constructor(private readonly runtime: PdfRuntimeModule) {}

  isOpen(): boolean {
    return this.docPtr !== null;
  }

  open(bytes: Uint8Array, password: string | null = null): void {
    if (this.docPtr) {
      throw new EngineError(EngineErrorCode.InvalidArg, 'document already open');
    }
    const { mem, fn } = this.runtime;
    const dataPtr = mem.alloc(bytes.byteLength);
    mem.writeBytes(dataPtr, bytes);
    const docPtr = fn.FPDF_LoadMemDocument(dataPtr, bytes.byteLength, password ?? '');
    if (!docPtr || docPtr === NULL_PTR) {
      mem.free(dataPtr);
      throw new EngineError(EngineErrorCode.DocOpenFailed, 'failed to open document');
    }
    this.docPtr = docPtr;
    this.dataPtr = dataPtr;
  }

  metadata(): MetadataServiceImpl {
    const ptr = this.requireDocPtr();
    return new MetadataServiceImpl(this.runtime, ptr);
  }

  close(): void {
    const { mem, fn } = this.runtime;
    if (this.docPtr) {
      fn.FPDF_CloseDocument(this.docPtr);
      this.docPtr = null;
    }
    if (this.dataPtr) {
      mem.free(this.dataPtr);
      this.dataPtr = null;
    }
  }

  private requireDocPtr(): Ptr {
    if (!this.docPtr) {
      throw new EngineError(EngineErrorCode.DocNotOpen, 'document is not open');
    }
    return this.docPtr;
  }
}
