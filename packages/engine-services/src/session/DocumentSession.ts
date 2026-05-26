import type { PdfRuntimeModule, Ptr } from '@embedpdf/pdf-runtime';
import type {
  DocumentSecurityProbeInfo,
  PageObjectNumber,
  PageState,
  PdfSaveMode,
  RevisionToken,
  WeakAnnotationState,
} from '@embedpdf/engine-core/runtime';
import {
  EngineError,
  EngineErrorCode,
  knownWeakAnnotationState,
  isValidPageObjectNumber,
} from '@embedpdf/engine-core/runtime';
import { MetadataServiceImpl } from '../MetadataServiceImpl';
import {
  openFatMemoryDocument,
  type OpenedPdfDocument,
  type OpenedPdfDocumentKind,
} from './PdfDocumentOpener';
import type { PageRecord } from './PageRecord';
import { PagePtrPool } from './PagePtrPool';
import { LocalRevisionAuthority, type RevisionAuthority } from './RevisionStore';

// PDF Standard security handlers reserve bits 1-2 as 0. PDFium masks even
// owner permissions through that convention, so full effective permissions for
// an encrypted document are 0xFFFFFFFC rather than 0xFFFFFFFF.
const ALL_STANDARD_SECURITY_PERMISSIONS = 0xfffffffc;

/**
 * Owns the lifecycle of a single open PDFium document and the v3
 * identity machinery: page registry (pageObjectNumber <-> pageIndex),
 * `RevisionStore` (per-page generation counters), and `PagePtrPool`
 * (refcounted pagePtr access).
 *
 * Both the local browser Worker and the server worker_thread instantiate
 * this exactly the same way; the only thing that differs is the
 * underlying PdfRuntimeModule (WASM vs native).
 */
export class DocumentSession {
  private docPtr: Ptr | null = null;
  private closeDocument: (() => void) | null = null;
  private _kind: OpenedPdfDocumentKind | null = null;
  private readonly _sessionId: string;

  /** pon -> record */
  private readonly recordsByObjectNumber = new Map<PageObjectNumber, PageRecord>();
  /** pageIndex -> record */
  private readonly recordsByIndex = new Map<number, PageRecord>();
  private fullyEnumerated = false;

  private revisions: RevisionAuthority | null = null;
  private pages: PagePtrPool | null = null;

  constructor(
    private readonly runtime: PdfRuntimeModule,
    sessionId?: string,
  ) {
    this._sessionId = sessionId ?? generateSessionId();
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get kind(): OpenedPdfDocumentKind | null {
    return this._kind;
  }

  isOpen(): boolean {
    return this.docPtr !== null;
  }

  open(bytes: Uint8Array, password: string | null = null): void {
    this.openFromHandle(openFatMemoryDocument(this.runtime, bytes, password));
  }

  openFromHandle(handle: OpenedPdfDocument): void {
    if (this.docPtr) {
      handle.close();
      throw new EngineError(EngineErrorCode.InvalidArg, 'document already open');
    }
    this.docPtr = handle.docPtr;
    this.closeDocument = () => handle.close();
    this._kind = handle.kind;
    this.revisions = new LocalRevisionAuthority(this._sessionId);
    this.pages = new PagePtrPool(runtimePagesAreSafe(this.runtime), handle.docPtr);
  }

  metadata(): MetadataServiceImpl {
    const ptr = this.requireDocPtr();
    return new MetadataServiceImpl(this.runtime, ptr);
  }

  /** Number of pages in the document. */
  pageCount(): number {
    return this.runtime.fn.FPDF_GetPageCount(this.requireDocPtr());
  }

  currentSecurityInfo(): DocumentSecurityProbeInfo {
    const docPtr = this.requireDocPtr();
    const encrypted = this.runtime.fn.EPDF_IsEncrypted(docPtr);
    const bits = normalizeU32(this.runtime.fn.FPDF_GetDocUserPermissions(docPtr));
    return {
      encryptionState: encrypted ? 'encrypted' : 'none',
      encryptionRequiresPassword: false,
      securityHandlerRevision: encrypted
        ? this.runtime.fn.FPDF_GetSecurityHandlerRevision(docPtr)
        : null,
      pdfPermissionsBits: bits,
      pdfPermissionsAllAllowed: hasAllStandardSecurityPermissions(bits),
      pdfOpenedAs: encrypted
        ? this.runtime.fn.EPDF_IsOwnerUnlocked(docPtr)
          ? 'owner'
          : 'user'
        : 'none',
      securityProbedAt: Date.now(),
    };
  }

  checkPasswordPermissions(
    password: string,
    mode: 'any' | 'owner' = 'any',
  ): DocumentSecurityProbeInfo {
    const docPtr = this.requireDocPtr();
    const { mem, fn } = this.runtime;
    const kindPtr = mem.alloc(4);
    const userPermissionsPtr = mem.alloc(4);
    const effectivePermissionsPtr = mem.alloc(4);
    const revisionPtr = mem.alloc(4);
    try {
      mem.poke(kindPtr, 'i32', 0);
      mem.poke(userPermissionsPtr, 'i32', 0);
      mem.poke(effectivePermissionsPtr, 'i32', 0);
      mem.poke(revisionPtr, 'i32', 0);
      const ok = fn.EPDF_CheckPasswordPermissions(
        docPtr,
        password,
        kindPtr,
        userPermissionsPtr,
        effectivePermissionsPtr,
        revisionPtr,
      );
      if (!ok) {
        throw new EngineError(EngineErrorCode.DocPasswordIncorrect, 'incorrect document password');
      }
      const openedAs = openedAsFromCode(Number(mem.peek(kindPtr, 'i32')));
      if (mode === 'owner' && openedAs !== 'owner') {
        throw new EngineError(EngineErrorCode.DocPasswordIncorrect, 'owner password required');
      }
      const bits = normalizeU32(Number(mem.peek(effectivePermissionsPtr, 'i32')));
      return {
        encryptionState: openedAs === 'none' ? 'none' : 'encrypted',
        encryptionRequiresPassword: false,
        securityHandlerRevision: openedAs === 'none' ? null : Number(mem.peek(revisionPtr, 'i32')),
        pdfPermissionsBits: bits,
        pdfPermissionsAllAllowed: hasAllStandardSecurityPermissions(bits),
        pdfOpenedAs: openedAs,
        securityProbedAt: Date.now(),
      };
    } finally {
      mem.free(revisionPtr);
      mem.free(effectivePermissionsPtr);
      mem.free(userPermissionsPtr);
      mem.free(kindPtr);
    }
  }

  /**
   * Lazily enumerate every page and cache (pageObjectNumber, pageIndex).
   * Necessary before `listRawAll()` and any pon -> pageIndex resolution.
   */
  ensureFullPageRegistry(): void {
    if (this.fullyEnumerated) return;
    const { fn } = this.runtime;
    const docPtr = this.requireDocPtr();
    const count = fn.FPDF_GetPageCount(docPtr);
    for (let i = 0; i < count; i++) {
      if (this.recordsByIndex.has(i)) continue;
      const pon = fn.EPDFDoc_GetPageObjectNumberByIndex(docPtr, i);
      if (!isValidPageObjectNumber(pon)) {
        // Spec violation: ISO 32000-1 §7.7.3.3 requires every
        // /Page to be referenced indirectly from the /Pages tree.
        // PDFium's loader is permissive enough to surface direct
        // page dicts from broken generators, but the engine's
        // identity model requires a real indirect object number,
        // so we refuse the document here with a clear, actionable
        // error rather than silently routing through a weak
        // identity path.
        throw new EngineError(
          EngineErrorCode.MalformedPdf,
          `page at index ${i} is a direct (non-indirect) PDF object; the engine requires every page to have a stable indirect object number`,
          { details: { pageIndex: i, pon } },
        );
      }
      const record: PageRecord = { pageObjectNumber: pon, pageIndex: i };
      this.recordsByIndex.set(i, record);
      this.recordsByObjectNumber.set(pon, record);
    }
    this.fullyEnumerated = true;
  }

  /** Lookup; populates the cache for one page only on cache miss. */
  recordByObjectNumber(pageObjectNumber: PageObjectNumber): PageRecord {
    const cached = this.recordsByObjectNumber.get(pageObjectNumber);
    if (cached) return cached;

    // Probe the doc by loading the page directly via its object number;
    // walk the index range to find which page index it lives at.
    const { fn } = this.runtime;
    const docPtr = this.requireDocPtr();
    const probePtr = fn.EPDFDoc_LoadPageByObjectNumber(docPtr, pageObjectNumber);
    if (!probePtr) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `no page with object number ${pageObjectNumber}`,
      );
    }
    fn.FPDF_ClosePage(probePtr);

    // Now we know the page exists; fall back to a full enumeration to get
    // its display index. This is O(pageCount) once per session.
    this.ensureFullPageRegistry();
    const found = this.recordsByObjectNumber.get(pageObjectNumber);
    if (!found) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `page with object number ${pageObjectNumber} present but unindexable`,
      );
    }
    return found;
  }

  recordByIndex(pageIndex: number): PageRecord {
    if (this.recordsByIndex.has(pageIndex)) return this.recordsByIndex.get(pageIndex)!;
    this.ensureFullPageRegistry();
    const found = this.recordsByIndex.get(pageIndex);
    if (!found) {
      throw new EngineError(EngineErrorCode.NotFound, `no page at index ${pageIndex}`);
    }
    return found;
  }

  /** All page records, in display order. Forces full enumeration. */
  allRecords(): PageRecord[] {
    this.ensureFullPageRegistry();
    return Array.from(this.recordsByIndex.entries())
      .sort(([a], [b]) => a - b)
      .map(([, r]) => r);
  }

  /**
   * Drop the cached `pageIndex <-> pageObjectNumber` mapping and force a
   * fresh enumeration on next access. Called by `DocumentPagesMutator`
   * after `FPDF_MovePages` shuffles page positions; we keep
   * weak-annotation knowledge and per-page revision counters intact, both of
   * which are keyed by durable `pageObjectNumber` and survive a page reorder.
   */
  refreshPageRegistry(): void {
    this.recordsByIndex.clear();
    this.recordsByObjectNumber.clear();
    this.fullyEnumerated = false;
    this.ensureFullPageRegistry();
  }

  /** Per-page state envelope used by every read/mutation result. */
  pageState(pageObjectNumber: PageObjectNumber): PageState {
    const record = this.recordByObjectNumber(pageObjectNumber);
    const weakAnnotationState = this.requireRevisions().weakAnnotationState(pageObjectNumber);
    return {
      pageObjectNumber,
      pageIndex: record.pageIndex,
      revision: this.requireRevisions().token(pageObjectNumber),
      weakAnnotationState,
    };
  }

  /** Set by readers as they discover whether a page has weak annotations. */
  recordWeakFlag(pageObjectNumber: PageObjectNumber, hasWeak: boolean): void {
    this.recordWeakAnnotationState(pageObjectNumber, knownWeakAnnotationState(hasWeak));
  }

  recordWeakAnnotationState(pageObjectNumber: PageObjectNumber, state: WeakAnnotationState): void {
    this.requireRevisions().recordWeakAnnotationState(pageObjectNumber, state);
  }

  weakAnnotationState(pageObjectNumber: PageObjectNumber): WeakAnnotationState {
    return this.requireRevisions().weakAnnotationState(pageObjectNumber);
  }

  /** Bump and return the new revision token; called by mutation paths. */
  bumpRevision(pageObjectNumber: PageObjectNumber): RevisionToken {
    return this.requireRevisions().bump(pageObjectNumber);
  }

  validateRevision(token: RevisionToken): void {
    this.requireRevisions().validate(token);
  }

  pagePool(): PagePtrPool {
    if (!this.pages) {
      throw new EngineError(EngineErrorCode.DocNotOpen, 'document is not open');
    }
    return this.pages;
  }

  requireDocPtr(): Ptr {
    if (!this.docPtr) {
      throw new EngineError(EngineErrorCode.DocNotOpen, 'document is not open');
    }
    return this.docPtr;
  }

  saveLayerArtifact(): { bytes: ArrayBuffer; size: number } {
    if (this._kind !== 'layer') {
      throw new EngineError(EngineErrorCode.InvalidArg, 'document session is not a layer');
    }

    const { mem, fn } = this.runtime;
    const sizePtr = mem.alloc(4);
    const statusPtr = mem.alloc(4);
    let artifactPtr: Ptr | null = null;
    try {
      mem.poke(sizePtr, 'i32', 0);
      mem.poke(statusPtr, 'i32', -1);
      artifactPtr = fn.EPDFLayer_SaveLayerArtifactToOwnedBuffer(
        this.requireDocPtr(),
        sizePtr,
        statusPtr,
      );
      const status = Number(mem.peek(statusPtr, 'i32'));
      const size = Number(mem.peek(sizePtr, 'i32'));
      if (!artifactPtr || status !== 0 || size <= 0) {
        throw layerSaveError(status);
      }

      const bytes = mem.readBytes(artifactPtr, size);
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      return { bytes: buffer, size };
    } finally {
      if (artifactPtr) fn.EPDF_FreeBuffer(artifactPtr);
      mem.free(statusPtr);
      mem.free(sizePtr);
    }
  }

  saveLayerArtifactToFile(path: string): { path: string } {
    if (this._kind !== 'layer') {
      throw new EngineError(EngineErrorCode.InvalidArg, 'document session is not a layer');
    }

    const { mem, fn } = this.runtime;
    const statusPtr = mem.alloc(4);
    const writer = this.runtime.fileWrite.toNodeFile(path);
    try {
      mem.poke(statusPtr, 'i32', -1);
      const ok = fn.EPDFLayer_SaveLayerArtifact(this.requireDocPtr(), writer.ptr, statusPtr);
      const status = Number(mem.peek(statusPtr, 'i32'));
      if (!ok || status !== 0) {
        throw layerSaveError(status);
      }
      return { path };
    } finally {
      writer.close();
      mem.free(statusPtr);
    }
  }

  saveStandaloneToBuffer(mode: PdfSaveMode): { bytes: ArrayBuffer; size: number } {
    const { mem, fn } = this.runtime;
    const sizePtr = mem.alloc(4);
    let pdfPtr: Ptr | null = null;
    try {
      mem.poke(sizePtr, 'i32', 0);
      // Standalone saves are not layer artifacts. For a CPDF_LayerDocument,
      // FPDF_INCREMENTAL copies the base bytes through and appends the layer
      // delta as a normal PDF revision. The EPDFLayer_* artifact APIs are only
      // for internal server storage.
      pdfPtr = fn.EPDF_SaveDocumentToOwnedBuffer(
        this.requireDocPtr(),
        pdfSaveModeFlags(mode),
        sizePtr,
      );
      const size = Number(mem.peek(sizePtr, 'i32'));
      if (!pdfPtr || size <= 0) {
        throw new EngineError(EngineErrorCode.DocOpenFailed, 'failed to save document');
      }

      const bytes = mem.readBytes(pdfPtr, size);
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      return { bytes: buffer, size };
    } finally {
      if (pdfPtr) fn.EPDF_FreeBuffer(pdfPtr);
      mem.free(sizePtr);
    }
  }

  saveStandaloneToFile(path: string, mode: PdfSaveMode): { path: string } {
    const writer = this.runtime.fileWrite.toNodeFile(path);
    try {
      // See saveStandaloneToBuffer(): this exports a standalone PDF view,
      // not the storage-optimized `.layer` artifact.
      const ok = this.runtime.fn.FPDF_SaveAsCopy(
        this.requireDocPtr(),
        writer.ptr,
        pdfSaveModeFlags(mode),
      );
      if (!ok) {
        throw new EngineError(EngineErrorCode.DocOpenFailed, 'failed to save document');
      }
      return { path };
    } finally {
      writer.close();
    }
  }

  close(): void {
    let firstError: unknown = null;
    try {
      this.pages?.closeAll();
    } catch (error) {
      firstError = error;
    } finally {
      this.pages = null;
    }

    try {
      this.closeDocument?.();
    } catch (error) {
      firstError ??= error;
    } finally {
      this.closeDocument = null;
      this.docPtr = null;
      this._kind = null;
      this.revisions?.clear();
      this.revisions = null;
      this.recordsByIndex.clear();
      this.recordsByObjectNumber.clear();
      this.fullyEnumerated = false;
    }

    if (firstError) throw firstError;
  }

  private requireRevisions(): RevisionAuthority {
    if (!this.revisions) {
      throw new EngineError(EngineErrorCode.DocNotOpen, 'document is not open');
    }
    return this.revisions;
  }
}

function runtimePagesAreSafe(rt: PdfRuntimeModule): PdfRuntimeModule {
  // Tiny indirection retained as a hook for future per-runtime guard
  // logic (e.g. asserting native vs wasm capabilities).
  return rt;
}

function generateSessionId(): string {
  // Lightweight id; no crypto dependency. Sufficient for the docSessionId
  // bleed-over check (which is local-process anyway).
  return `sess_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function layerSaveError(status: number): EngineError {
  if (status === 1) {
    return new EngineError(
      EngineErrorCode.DocOpenFailed,
      'layer artifact cannot be saved because append-only offsets exceed the supported range',
    );
  }
  return new EngineError(EngineErrorCode.DocOpenFailed, 'failed to save layer artifact');
}

const FPDF_INCREMENTAL = 1 << 0;
const FPDF_NO_INCREMENTAL = 1 << 1;

function pdfSaveModeFlags(mode: PdfSaveMode): number {
  return mode === 'incremental' ? FPDF_INCREMENTAL : FPDF_NO_INCREMENTAL;
}

function normalizeU32(value: number): number {
  return value >>> 0;
}

function hasAllStandardSecurityPermissions(bits: number): boolean {
  return (
    (normalizeU32(bits) & ALL_STANDARD_SECURITY_PERMISSIONS) >>> 0 ===
    ALL_STANDARD_SECURITY_PERMISSIONS
  );
}

function openedAsFromCode(code: number): 'none' | 'user' | 'owner' {
  // Mirrors EPDF_PASSWORD_PERMISSION_* in public/fpdfview.h:
  // invalid=0, none=1, user=2, owner=3.
  if (code === 3) return 'owner';
  if (code === 2) return 'user';
  return 'none';
}
