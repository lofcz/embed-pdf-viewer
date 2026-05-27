import type { PdfBits } from '../auth/scope';
import type { AbortablePromise } from '../promise/AbortablePromise';

export type DocumentOpenMode = 'none' | 'user' | 'owner';
export type DocumentEncryptionState = 'unknown' | 'none' | 'encrypted' | 'unsupported';
export type DocumentAccessReason = 'password' | 'cdn' | 'permissions-unknown';

/**
 * Boolean view of "what the PDF's permission bits allow," surfaced for
 * client UI badges ("this PDF disallows printing", "copy is blocked",
 * etc.). Names mirror the user-facing capability they correspond to,
 * not the raw bit names — so docs can render "Print: disabled" without
 * the reader needing to know PDF bit positions.
 *
 * Computed from {@link PdfBits} via the strict ISO 32000 rules:
 *   bit 12 only meaningful when bit 3 is also set
 *   form modification requires both bit 6 AND bit 4
 *   form fill is satisfied by bit 6 OR bit 9
 */
export interface PdfPermissionAdvisory {
  readonly canPrint: boolean;
  readonly canPrintHigh: boolean;
  readonly canCopy: boolean;
  readonly canAnnotate: boolean;
  readonly canFillForms: boolean;
  readonly canModifyForms: boolean;
  readonly canModifyPages: boolean;
  readonly canAssemble: boolean;
}

export interface PdfPermissionInfo {
  readonly known: boolean;
  readonly allAllowed: boolean | null;
  readonly bits: number | null;
  readonly openedAs: DocumentOpenMode | null;
  readonly securityHandlerRevision: number | null;
  /**
   * Typed boolean view of `bits`. Present whenever the caller had
   * access to the document's PDF bits at construction time (always
   * true in the /access response; not always populated by the cheaper
   * /head shape).
   */
  readonly flags?: PdfBits;
  /**
   * Capability-shaped "what does this PDF natively allow" view for UI
   * badges. Same population rule as `flags`.
   */
  readonly advisory?: PdfPermissionAdvisory;
}

export interface DocumentSecurityState {
  readonly encryption: {
    readonly state: DocumentEncryptionState;
    readonly requiresPassword: boolean | null;
  };
  readonly permissions: {
    readonly known: boolean;
    readonly bits: number | null;
    readonly allAllowed: boolean | null;
    readonly openedAs: DocumentOpenMode | null;
    readonly securityHandlerRevision: number | null;
    readonly canUpgradeToOwner: boolean;
  };
  readonly access: {
    readonly required: boolean;
    readonly reasons: DocumentAccessReason[];
    readonly endpoint?: string;
  };
}

export interface CdnAccessInfo {
  readonly adapter:
    | 'none'
    | 'cloudfront'
    | 'cloud-cdn'
    | 'cloudflare'
    | 'bunny'
    | 'azure-fd'
    | 'custom-hmac';
  readonly expiresAt: number;
  readonly cache: {
    readonly scope: 'browser-private' | 'edge-shared';
    readonly immutableVersionedReads: boolean;
  };
  readonly baseUrlOverrides: Partial<Record<string, string>> | null;
  readonly authHeader: { name: string; value: string } | null;
}

export interface DocumentAccessInfo {
  readonly cdn: CdnAccessInfo;
  readonly passwordGrant: string | null;
  readonly pdfPermissions: PdfPermissionInfo | null;
  /**
   * Raw scope array exactly as the JWT carried it. Useful for debugging
   * and for clients that want to display the literal grants.
   */
  readonly scope: string[];
  /**
   * Concrete capability set granted to this caller, after expanding
   * `pdf.permissions` against the document's PDF bits and applying
   * the implication rules in the resolver (e.g. annotation collab
   * scopes imply `doc.annotate.read`). Client UI should drive feature
   * visibility off this, not off the raw `scope`.
   *
   * Sorted alphabetically for stable display.
   */
  readonly effectiveScope: string[];
  readonly identity: {
    readonly user_id?: string;
    readonly group_id?: string;
    readonly groups?: string[];
    readonly display_name?: string;
  };
  readonly originPasswordPolicy: {
    readonly mode: 'not-needed' | 'client-retry' | 'server-session';
  };
  readonly expiresAt: number;
}

export interface DocumentUnlockInput {
  readonly password: string;
  readonly mode?: 'any' | 'owner';
}

export interface DocumentUnlockResult {
  readonly security: DocumentSecurityState;
  readonly access?: DocumentAccessInfo;
}

export interface DocumentSecurityService {
  readonly current: DocumentSecurityState;
  unlock(input: DocumentUnlockInput): AbortablePromise<DocumentUnlockResult>;
}
