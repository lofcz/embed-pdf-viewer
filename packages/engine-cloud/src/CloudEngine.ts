import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  type DocumentHandle,
  type Engine,
  type OpenInput,
  type OpenOptions,
} from '@embedpdf/engine-core/runtime';
import {
  DEFAULT_LAYER_NAME,
  DocumentHeadSchema,
  OpenDocumentResponseSchema,
  wirePaths,
} from '@embedpdf/engine-core/wire';
import { HttpClient, type HttpClientOptions } from './transport/HttpClient';
import { CloudDocumentHandle } from './document/CloudDocumentHandle';
import { decodeUnverifiedClaims } from './transport/decodeUnverifiedClaims';

export interface CloudEngineOptions extends HttpClientOptions {}

/**
 * Cloud engine: speaks the same Engine interface as @embedpdf/engine-local
 * but routes everything through HTTPS to a remote @embedpdf/server (or
 * CloudPDF SaaS). Identical observable contract; only the transport differs.
 */
export class CloudEngine implements Engine {
  static fromOptions(opts: CloudEngineOptions): CloudEngine {
    return new CloudEngine(new HttpClient(opts));
  }

  private destroyed = false;

  private constructor(private readonly http: HttpClient) {}

  open(input: OpenInput, options?: OpenOptions): AbortablePromise<DocumentHandle> {
    if (this.destroyed) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.RuntimeUnavailable, 'engine destroyed'),
      );
    }

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
        return new CloudDocumentHandle(docHttp, head.id, layerName);
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
        if (!input.layerName && input.token) {
          const token = await docHttp.currentToken();
          const claims = decodeUnverifiedClaims(token);
          if (typeof claims.layer_name === 'string' && claims.layer_name.length > 0) {
            layerName = claims.layer_name;
          }
        }
        const head = await docHttp.getJson(
          wirePaths.layerHead(id, layerName),
          (raw) => DocumentHeadSchema.parse(raw),
          signal,
        );
        return new CloudDocumentHandle(docHttp, head.id, layerName);
      });
    }

    if (input.kind !== 'bytes') {
      return AbortablePromise.rejectReason(
        new EngineError(
          EngineErrorCode.InvalidArg,
          `cloud engine: unknown OpenInput.kind '${(input as { kind?: string }).kind}'`,
        ),
      );
    }

    // Legacy `kind: 'bytes'` upload path. Hits the pre-Phase-3
    // `POST /v1/documents` route and creates a doc record on the
    // fly. Phase 5 replaces this with the admin lifecycle (init +
    // commit) plus a subsequent token-open; at that point this
    // branch is deleted from the cloud engine.
    const password = options?.password ?? input.password ?? null;
    const id = input.id;
    const bytes = input.bytes;

    return AbortablePromise.run<DocumentHandle>(async (signal) => {
      const form = new FormData();
      form.append('id', id);
      if (password != null) form.append('password', password);
      const fileBlob =
        bytes instanceof ArrayBuffer
          ? new Blob([bytes])
          : new Blob([
              new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice().buffer,
            ]);
      form.append('file', fileBlob, `${id}.pdf`);
      const response = await this.http.postMultipartJson(
        wirePaths.documents,
        form,
        (raw) => OpenDocumentResponseSchema.parse(raw),
        signal,
      );
      return new CloudDocumentHandle(this.http, response.id, DEFAULT_LAYER_NAME, false);
    });
  }

  destroy(): AbortablePromise<void> {
    if (this.destroyed) return AbortablePromise.resolveValue<void>(undefined);
    this.destroyed = true;
    return AbortablePromise.resolveValue<void>(undefined);
  }
}
