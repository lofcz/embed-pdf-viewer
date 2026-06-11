import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  type DocumentHandle,
  type Engine,
  type OpenInput,
  type OpenOptions,
} from '@embedpdf/engine-core/runtime';
import { DEFAULT_LAYER_NAME, DocumentHeadSchema, wirePaths } from '@embedpdf/engine-core/wire';
import { generateUuid } from '@embedpdf/engine-services';
import { HttpClient, type HttpClientOptions } from './transport/HttpClient';
import { CloudDocumentHandle } from './document/CloudDocumentHandle';
import { CloudDocumentSecurityService } from './document/CloudDocumentSecurityService';
import { decodeUnverifiedClaims } from './transport/decodeUnverifiedClaims';

export interface CloudEngineOptions extends HttpClientOptions {}

/**
 * Cloud engine: speaks the same Engine interface as @embedpdf/engine
 * but routes everything through HTTPS to a remote @cloudpdf/server (or
 * CloudPDF SaaS). Identical observable contract; only the transport differs.
 */
export class CloudEngine implements Engine {
  static fromOptions(opts: CloudEngineOptions): CloudEngine {
    return new CloudEngine(new HttpClient(opts));
  }

  private destroyed = false;

  /** This engine instance's identity on every event's `origin.sessionId`. */
  private readonly sessionId = `cloud:${generateUuid()}`;

  private constructor(private readonly http: HttpClient) {}

  open(input: OpenInput, options?: OpenOptions): AbortablePromise<DocumentHandle> {
    if (this.destroyed) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.RuntimeUnavailable, 'engine destroyed'),
      );
    }
    // Cloud reads scope + identity from the doc-scoped JWT — `options.scope`
    // and `options.identity` are engine-local concepts and are intentionally
    // ignored here. Same `OpenOptions` type for both engines is what makes
    // SDK code portable; the JWT is the authority cloud-side.
    void options?.scope;
    void options?.identity;

    if (input.kind === 'token') {
      // Open by doc-scoped JWT. We never verify the token SDK-side
      // (server is the verifier of record); we just decode the
      // unsigned payload to learn `doc_id`, then route to /head with
      // the per-open bearer. The resulting handle owns its own
      // scoped HttpClient — every subsequent RPC carries this
      // token, NOT the engine-level one, so one engine can hold
      // many handles each with a different bearer.
      const tokenSource = input.token;
      return AbortablePromise.run<DocumentHandle>(async (signal) => {
        const docHttp = this.http.withToken(tokenSource);
        const token = await docHttp.currentToken();
        const claims = decodeUnverifiedClaims(token);
        const docId = claims.doc_id;
        if (typeof docId !== 'string' || docId.length === 0) {
          throw new EngineError(
            EngineErrorCode.InvalidArg,
            'cloud engine: token has no doc_id claim — mint a doc-scoped JWT',
          );
        }
        const layerName =
          typeof claims.layer_name === 'string' && claims.layer_name.length > 0
            ? claims.layer_name
            : DEFAULT_LAYER_NAME;
        const head = await docHttp.getJson(
          wirePaths.layerHead(docId, layerName),
          (raw) => DocumentHeadSchema.parse(raw),
          signal,
        );
        const handle = new CloudDocumentHandle(
          docHttp,
          head.id,
          layerName,
          head,
          token,
          this.sessionId,
        );
        await maybeAutoEstablishAccess(handle, head, signal);
        return handle;
      });
    }

    if (input.kind === 'id') {
      // Open by docId using the engine-level token (typical: a
      // tenant JWT). The caller can override per-open by setting
      // `input.token`; the resulting handle then carries that
      // override for all of its RPCs.
      const id = input.id;
      const docHttp = input.token ? this.http.withToken(input.token) : this.http;
      return AbortablePromise.run<DocumentHandle>(async (signal) => {
        let layerName = input.layerName ?? DEFAULT_LAYER_NAME;
        // Resolve the bearer once so we have it for the layer-name
        // claim AND for the security service's local-fallback scope/
        // identity. May be null when the engine has no token at all
        // (caller invokes /head anonymously — server will reject).
        let resolvedToken: string | null = null;
        try {
          resolvedToken = await docHttp.currentToken();
        } catch {
          resolvedToken = null;
        }
        if (!input.layerName && resolvedToken) {
          const claims = decodeUnverifiedClaims(resolvedToken);
          if (typeof claims.layer_name === 'string' && claims.layer_name.length > 0) {
            layerName = claims.layer_name;
          }
        }
        const head = await docHttp.getJson(
          wirePaths.layerHead(id, layerName),
          (raw) => DocumentHeadSchema.parse(raw),
          signal,
        );
        const handle = new CloudDocumentHandle(
          docHttp,
          head.id,
          layerName,
          head,
          resolvedToken,
          this.sessionId,
        );
        await maybeAutoEstablishAccess(handle, head, signal);
        return handle;
      });
    }

    void options;
    return AbortablePromise.rejectReason(
      new EngineError(
        EngineErrorCode.InvalidArg,
        `cloud engine supports OpenInput.kind === 'token' or 'id' (got '${(input as { kind?: string }).kind}')`,
      ),
    );
  }

  destroy(): AbortablePromise<void> {
    if (this.destroyed) return AbortablePromise.resolveValue<void>(undefined);
    this.destroyed = true;
    return AbortablePromise.resolveValue<void>(undefined);
  }
}

/**
 * If `/head` told us the server needs `/v1/access` to be called and
 * the only reason is `'cdn'` (i.e. no password unlock waiting on
 * user input), call it transparently so the SDK picks up CDN-signed
 * URLs and the cookie/header side effects before the dev makes
 * their first render/text/annotation request.
 *
 * If a password is required, we DON'T auto-call — the dev has to
 * prompt the user and call `doc.security.unlock({ password })`.
 * That code path runs the same /access POST and installs the CDN
 * binding on success.
 *
 * Errors here are swallowed by design: a failed auto-establish
 * shouldn't break `open()`. The first real request still tries
 * origin, where the JWT check rejects if the scope is wrong;
 * developers see a regular Forbidden then instead of a confusing
 * open-time crash.
 */
async function maybeAutoEstablishAccess(
  handle: CloudDocumentHandle,
  head: { access: { required: boolean; reasons: ReadonlyArray<string> } },
  signal: AbortSignal,
): Promise<void> {
  if (!head.access.required) return;
  const reasons = new Set(head.access.reasons);
  if (reasons.has('password')) return; // wait for explicit unlock()
  if (!reasons.has('cdn')) return; // nothing actionable for the SDK
  // CloudDocumentSecurityService exposes `establishAccess()` — the
  // no-password sibling of `unlock()`. The public DocumentSecurityService
  // interface doesn't carry it (unlock = user action), but every
  // CloudDocumentHandle's `.security` is a CloudDocumentSecurityService.
  const security = handle.security as CloudDocumentSecurityService;
  const pending = security.establishAccess();
  // Link cancellation: if the outer open() is aborted while /access
  // is in flight, propagate the abort instead of leaking the request.
  const onAbort = () => pending.abort(signal.reason ?? new Error('aborted'));
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  try {
    await pending;
  } catch {
    // Intentional: a transient /access failure shouldn't block open().
    // Subsequent requests fall back to origin via the JWT bearer.
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
