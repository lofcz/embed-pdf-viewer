import type { PageObjectNumber } from '../identity/PageObjectNumber';
import type { RevisionToken } from './RevisionToken';

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
   * `true` when at least one annotation on this page has
   * `identityQuality === 'weak'`. Drives the mutation-impact computation.
   */
  hasAnyWeakAnnotations: boolean;
}
