import type { PageObjectNumber } from '../identity/PageObjectNumber';
import type { RevisionToken } from './RevisionToken';
import type { WeakAnnotationState } from './WeakAnnotationState';

/**
 * Per-page state envelope returned with reads and mutation metadata. This is
 * deliberately cache-agnostic: it carries page identity, display position,
 * weak-ref revision state, and explicit knowledge about weak annotations.
 */
export interface PageState {
  pageObjectNumber: PageObjectNumber;
  /** Display order; may shift when pages are inserted/deleted/reordered. */
  pageIndex: number;
  revision: RevisionToken;
  /**
   * Explicit knowledge state for the weak-annotation scan. `unknown` means the
   * page has not been scanned yet; it must not be published as a CDN/cache
   * boolean.
   */
  weakAnnotationState: WeakAnnotationState;
}
