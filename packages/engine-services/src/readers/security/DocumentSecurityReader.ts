import type { PdfRuntimeModule, Ptr } from '@embedpdf/pdf-runtime';
import type { DocumentSecurityProbeInfo } from '@embedpdf/engine-core/runtime';
import { ensureInitialized } from '../../runtime-bootstrap';

const FPDF_ERR_PASSWORD = 4;
const FPDF_ERR_SECURITY = 5;
const ALL_PERMISSIONS = 0xffffffff;

export class DocumentSecurityReader {
  constructor(private readonly runtime: PdfRuntimeModule) {
    // WorkerHost initializes the runtime before dispatching jobs, but
    // this reader is intentionally usable as a one-shot probe too.
    // `ensureInitialized()` is idempotent per runtime instance.
    ensureInitialized(this.runtime);
  }

  probeFile(path: string, password: string | null = null): DocumentSecurityProbeInfo {
    const now = Date.now();
    let access: ReturnType<PdfRuntimeModule['fileAccess']['fromNodeFile']> | null = null;
    let docPtr: Ptr | null = null;
    try {
      access = this.runtime.fileAccess.fromNodeFile(path);
      docPtr = this.runtime.fn.FPDF_LoadCustomDocument(access.ptr, password ?? '');
      if (!docPtr) {
        const err = this.runtime.fn.FPDF_GetLastError();
        if (err === FPDF_ERR_PASSWORD) {
          return {
            encryptionState: 'encrypted',
            encryptionRequiresPassword: true,
            securityHandlerRevision: null,
            pdfPermissionsBits: null,
            pdfPermissionsAllAllowed: null,
            pdfOpenedAs: null,
            securityProbedAt: now,
          };
        }
        if (err === FPDF_ERR_SECURITY) {
          return {
            encryptionState: 'unsupported',
            encryptionRequiresPassword: null,
            securityHandlerRevision: null,
            pdfPermissionsBits: null,
            pdfPermissionsAllAllowed: null,
            pdfOpenedAs: null,
            securityProbedAt: now,
          };
        }
        return unknownSecurity(now);
      }

      const encrypted = this.runtime.fn.EPDF_IsEncrypted(docPtr);
      const bits = normalizeU32(this.runtime.fn.FPDF_GetDocPermissions(docPtr));
      const openedAs = !encrypted
        ? 'none'
        : this.runtime.fn.EPDF_IsOwnerUnlocked(docPtr)
          ? 'owner'
          : 'user';
      return {
        encryptionState: encrypted ? 'encrypted' : 'none',
        encryptionRequiresPassword: false,
        securityHandlerRevision: encrypted
          ? this.runtime.fn.FPDF_GetSecurityHandlerRevision(docPtr)
          : null,
        pdfPermissionsBits: bits,
        pdfPermissionsAllAllowed: bits === ALL_PERMISSIONS,
        pdfOpenedAs: openedAs,
        securityProbedAt: now,
      };
    } finally {
      if (docPtr) this.runtime.fn.FPDF_CloseDocument(docPtr);
      access?.close();
    }
  }
}

function unknownSecurity(now: number): DocumentSecurityProbeInfo {
  return {
    encryptionState: 'unknown',
    encryptionRequiresPassword: null,
    securityHandlerRevision: null,
    pdfPermissionsBits: null,
    pdfPermissionsAllAllowed: null,
    pdfOpenedAs: null,
    securityProbedAt: now,
  };
}

function normalizeU32(value: number): number {
  return value >>> 0;
}
