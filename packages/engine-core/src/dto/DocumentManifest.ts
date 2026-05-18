import type { PageState } from '../revision/PageState';
import type { CachePins } from './CachePins';

/**
 * Per-page envelope inside `DocumentManifest`.
 *
 * `state` is universal document/page state; `cache` is the cloud/CDN read
 * coordinate for immutable leaf URLs.
 */
export interface ManifestPage {
  state: PageState;
  cache: CachePins;
}

/**
 * Versioned document/layer manifest. `docVersion` addresses the manifest
 * itself; each page row addresses its own immutable leaf URLs.
 */
export interface DocumentManifest {
  docVersion: number;
  baseSha: string;
  pages: ManifestPage[];
}
