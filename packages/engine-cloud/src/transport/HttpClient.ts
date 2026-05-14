import {
  AbortError,
  EngineError,
  EngineErrorCode,
  type SerializedEngineError,
} from '@embedpdf/engine-core/runtime';
import { EngineErrorPayloadSchema } from '@embedpdf/engine-core/wire';

export interface HttpClientOptions {
  baseUrl: string;
  /**
   * Optional bearer token. Either a string or a function that
   * returns a fresh token on every call (so callers can rotate
   * without re-creating the engine). When absent, requests go out
   * without an `Authorization` header — useful for the public-share
   * scenario where the doc-scoped token is provided per-`open` and
   * the engine itself has no engine-level credentials.
   */
  token?: string | (() => string | Promise<string>);
  /** Replace the global fetch (e.g. in Node tests with undici). */
  fetch?: typeof globalThis.fetch;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly tokenFn: (() => string | Promise<string>) | null;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    const token = opts.token;
    this.tokenFn = token === undefined ? null : typeof token === 'function' ? token : () => token;
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Return a clone of this client bound to a different bearer. Used
   * by `CloudEngine.open` to mint a per-handle client carrying the
   * per-open token, so each opened document's RPCs go out under
   * the right authorization without disturbing the engine-level
   * token.
   */
  withToken(token: string | (() => string | Promise<string>)): HttpClient {
    return new HttpClient({
      baseUrl: this.baseUrl,
      token,
      fetch: this.fetchFn,
    });
  }

  /**
   * Resolve the current bearer token. Awaits the user-supplied
   * token factory if it returns a promise. Used by the cloud
   * engine to read doc-scoped claims **without** verifying — the
   * server is the verifier of record. Throws when no token is
   * configured.
   */
  async currentToken(): Promise<string> {
    if (!this.tokenFn) {
      throw new EngineError(EngineErrorCode.InvalidArg, 'http client has no token configured');
    }
    return await this.tokenFn();
  }

  async getJson<T>(path: string, parser: (raw: unknown) => T, signal: AbortSignal): Promise<T> {
    const res = await this.request(path, { method: 'GET', signal });
    return await this.parseJsonResponse(res, parser);
  }

  async postMultipartJson<T>(
    path: string,
    body: FormData,
    parser: (raw: unknown) => T,
    signal: AbortSignal,
  ): Promise<T> {
    const res = await this.request(path, { method: 'POST', body, signal });
    return await this.parseJsonResponse(res, parser);
  }

  async postJson<T>(
    path: string,
    body: unknown,
    parser: (raw: unknown) => T,
    signal: AbortSignal,
  ): Promise<T> {
    const res = await this.requestJson(path, 'POST', body, signal);
    return await this.parseJsonResponse(res, parser);
  }

  async patchJson<T>(
    path: string,
    body: unknown,
    parser: (raw: unknown) => T,
    signal: AbortSignal,
  ): Promise<T> {
    const res = await this.requestJson(path, 'PATCH', body, signal);
    return await this.parseJsonResponse(res, parser);
  }

  async deleteJson<T>(path: string, parser: (raw: unknown) => T, signal: AbortSignal): Promise<T> {
    const res = await this.request(path, { method: 'DELETE', signal });
    return await this.parseJsonResponse(res, parser);
  }

  async deleteEmpty(path: string, signal: AbortSignal): Promise<void> {
    const res = await this.request(path, { method: 'DELETE', signal });
    if (res.status === 204) return;
    if (!res.ok) await this.throwFromBody(res);
  }

  private requestJson(
    path: string,
    method: 'POST' | 'PATCH' | 'PUT',
    body: unknown,
    signal: AbortSignal,
  ): Promise<Response> {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    return this.request(path, {
      method,
      body: JSON.stringify(body ?? {}),
      headers,
      signal,
    });
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers ?? {});
    if (this.tokenFn) {
      const token = await this.tokenFn();
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    try {
      return await this.fetchFn(url, { ...init, headers });
    } catch (err) {
      // undici's fetch propagates whatever was passed to AbortController.abort().
      // Anything that arrives while signal.aborted is true is an abort, regardless
      // of the wire-shape (DOMException, plain Error, string, ...).
      if (init.signal?.aborted) {
        throw new AbortError(init.signal.reason ?? err);
      }
      if ((err as { name?: string } | null)?.name === 'AbortError') {
        throw new AbortError((err as Error).message);
      }
      throw new EngineError(
        EngineErrorCode.Network,
        `network error: ${(err as Error)?.message ?? err}`,
        {
          cause: err,
        },
      );
    }
  }

  private async parseJsonResponse<T>(res: Response, parser: (raw: unknown) => T): Promise<T> {
    if (!res.ok) await this.throwFromBody(res);
    const json: unknown = await res.json().catch(() => ({}));
    try {
      return parser(json);
    } catch (err) {
      throw new EngineError(
        EngineErrorCode.WireFormat,
        `unexpected response shape: ${(err as Error)?.message ?? err}`,
        {
          cause: err,
        },
      );
    }
  }

  private async throwFromBody(res: Response): Promise<never> {
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    const code = mapStatusToCode(res.status);
    if (payload && typeof payload === 'object' && 'error' in payload) {
      const inner = (payload as { error: unknown }).error;
      const parsed = trySerialized(inner);
      if (parsed) throw new EngineError(parsed.code, parsed.message, { details: parsed.details });
      const msg =
        typeof inner === 'object' && inner && 'message' in inner
          ? String((inner as { message: unknown }).message)
          : `HTTP ${res.status}`;
      throw new EngineError(code, msg, { details: { status: res.status } });
    }
    throw new EngineError(code, `HTTP ${res.status}`, { details: { status: res.status } });
  }
}

function mapStatusToCode(status: number): EngineErrorCode {
  if (status === 401) return EngineErrorCode.Unauthenticated;
  if (status === 403) return EngineErrorCode.Forbidden;
  if (status === 404) return EngineErrorCode.NotFound;
  if (status === 422) return EngineErrorCode.DocOpenFailed;
  if (status === 499) return EngineErrorCode.Aborted;
  if (status === 400) return EngineErrorCode.InvalidArg;
  return EngineErrorCode.Unknown;
}

function trySerialized(value: unknown): SerializedEngineError | null {
  const result = EngineErrorPayloadSchema.safeParse(value);
  return result.success ? result.data : null;
}
