import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  securityStateFromHead,
  type DocumentAccessInfo,
  type DocumentSecurityService,
  type DocumentSecurityState,
  type DocumentUnlockInput,
  type DocumentUnlockResult,
} from '@embedpdf/engine-core/runtime';
import { AccessResponseSchema, wirePaths, type DocumentHead } from '@embedpdf/engine-core/wire';
import type { HttpClient } from '../transport/HttpClient';

export class CloudDocumentSecurityService implements DocumentSecurityService {
  private state: DocumentSecurityState;
  private access: DocumentAccessInfo | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly docId: string,
    private readonly layerName: string,
    initialHead: DocumentHead,
    private readonly view: { isClosed(): boolean },
  ) {
    this.state = securityStateFromHead(initialHead);
  }

  get current(): DocumentSecurityState {
    return this.state;
  }

  get currentAccess(): DocumentAccessInfo | null {
    return this.access;
  }

  unlock(input: DocumentUnlockInput): AbortablePromise<DocumentUnlockResult> {
    if (this.view.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<DocumentUnlockResult>(async (signal) => {
      const response = await this.http.postJson(
        wirePaths.access,
        {
          docId: this.docId,
          layerName: this.layerName,
          password: input.password,
          mode: input.mode ?? 'any',
        },
        (raw) => AccessResponseSchema.parse(raw),
        signal,
      );
      this.state = response.security;
      this.access = {
        cdn: response.cdn,
        passwordGrant: response.passwordGrant,
        pdfPermissions: response.pdfPermissions,
        scope: response.scope,
        effectiveScope: response.effectiveScope,
        identity: response.identity,
        originPasswordPolicy: response.originPasswordPolicy,
        expiresAt: response.expiresAt,
      };
      // DocumentUnlockResult.access is `DocumentAccessInfo | undefined`,
      // not `| null`. We carry the local cache as `| null` (clearer
      // "not yet unlocked" semantic); coerce at the boundary.
      return { security: this.state, access: this.access ?? undefined };
    });
  }
}
