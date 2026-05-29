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
 *
 * `layoutVersion` is the doc-level version pointer for the page-geometry
 * resource (`/layout@layoutVersion`). It bumps only on structural page ops
 * (move/insert/delete/rotate), NOT on annotation or content edits — a
 * different cadence than `docVersion`. The layout bytes themselves are NOT
 * in the manifest; only this pointer is, mirroring how per-page
 * `cache.contentVersion` points at the immutable text/render leaves.
 */
export interface DocumentManifest {
  docVersion: number;
  layoutVersion: number;
  baseSha: string;
  pages: ManifestPage[];
}
