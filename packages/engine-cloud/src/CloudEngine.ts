import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  type DocumentHandle,
  type Engine,
  type OpenInput,
  type OpenOptions,
} from '@embedpdf/engine-core/runtime';
import { OpenDocumentResponseSchema, wirePaths } from '@embedpdf/engine-core/wire';
import { HttpClient, type HttpClientOptions } from './transport/HttpClient';
import { CloudDocumentHandle } from './document/CloudDocumentHandle';

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

    if (input.kind === 'preuploaded') {
      return AbortablePromise.resolveValue<DocumentHandle>(
        new CloudDocumentHandle(this.http, input.id),
      );
    }

    if (input.kind !== 'bytes') {
      return AbortablePromise.rejectReason(
        new EngineError(
          EngineErrorCode.InvalidArg,
          `cloud engine: unknown OpenInput.kind '${(input as { kind?: string }).kind}'`,
        ),
      );
    }

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
      return new CloudDocumentHandle(this.http, response.id);
    });
  }

  destroy(): AbortablePromise<void> {
    if (this.destroyed) return AbortablePromise.resolveValue<void>(undefined);
    this.destroyed = true;
    return AbortablePromise.resolveValue<void>(undefined);
  }
}
