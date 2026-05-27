import { AbortablePromise } from '../promise/AbortablePromise';
import type { OpenInput, OpenOptions } from '../dto/OpenInput';
import type { DocumentHandle } from './DocumentHandle';

/**
 * Engine contract shared by `@embedpdf/engine-local` and
 * `@embedpdf/engine-cloud`. Both implementations expose the same
 * `open()` surface and return the same {@link DocumentHandle} shape;
 * the only observable difference is transport — local goes through a
 * Worker + WASM PDFium, cloud goes through HTTPS to a remote server.
 *
 * Authorization parity:
 *   - Cloud reads scope + identity from the doc-scoped JWT it gets at
 *     transport setup time. `OpenOptions.scope` / `OpenOptions.identity`
 *     are silently ignored by cloud (the JWT is the authority).
 *   - Local reads scope + identity from `OpenOptions.scope` /
 *     `OpenOptions.identity` (no JWT involved). Defaults to `['*']`
 *     wildcard with a one-time console warning.
 *
 * Both engines run the same resolver against the same `pdf.permissions`
 * expansion → identical allow/deny decisions for the same
 * scope+identity+PDF-bits inputs. The parity test at
 * `engine-core/test/scope-parity.test.ts` (commit 17) locks this in.
 */
export interface Engine {
  open(input: OpenInput, options?: OpenOptions): AbortablePromise<DocumentHandle>;
  destroy(): AbortablePromise<void>;
}
