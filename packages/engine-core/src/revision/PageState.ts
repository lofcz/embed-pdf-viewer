import type { PageObjectNumber } from '../identity/PageObjectNumber';
import type { RevisionToken } from './RevisionToken';
import type { WeakAnnotationState } from './WeakAnnotationState';

/**
 * Per-page state envelope returned with every annotation list and every
 * mutation result. Carries the current revision (so clients can hand it
 * back as part of a weak `AnnotationRef.kind === 'index'`) and a flag
 * telling the client whether any annotation on this page lacks a durable
 * id. That flag is what lets the engine compute
 * `AnnotationListMutationMeta.weakRefsInvalidated` without the client
 * having to reason about it.
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
  /**
   * `true` when at least one annotation on this page has
   * `identityQuality === 'weak'`. Drives the mutation-impact computation.
   * Kept as a compatibility/convenience mirror for local transient results;
   * cacheable manifests must derive their boolean from `weakAnnotationState`
   * only when it is `known`.
   */
  hasAnyWeakAnnotations: boolean;
}
