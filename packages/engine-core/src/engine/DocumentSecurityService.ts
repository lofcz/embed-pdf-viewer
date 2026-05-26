import type { AbortablePromise } from '../promise/AbortablePromise';

export type DocumentOpenMode = 'none' | 'user' | 'owner';
export type DocumentEncryptionState = 'unknown' | 'none' | 'encrypted' | 'unsupported';
export type DocumentAccessReason = 'password' | 'cdn' | 'permissions-unknown';

export interface PdfPermissionInfo {
  readonly known: boolean;
  readonly allAllowed: boolean | null;
  readonly bits: number | null;
  readonly openedAs: DocumentOpenMode | null;
  readonly securityHandlerRevision: number | null;
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
  readonly scope: string[];
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
