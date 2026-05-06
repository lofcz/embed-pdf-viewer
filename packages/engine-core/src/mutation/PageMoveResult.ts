import type { PageState } from '../revision/PageState';

/**
 * Result of a `pages.move()`. Page reorder is intentionally **outside**
 * the per-page revision/weak-ref model:
 *
 *   - Pages are always identified by `pageObjectNumber`; there is no
 *     such thing as a "weak page ref", so no doc-level revision needs
 *     to be bumped to invalidate caller state.
 *   - Per-page `RevisionToken`s are NOT bumped on page move — the
 *     /Annots array of each moved page is untouched, so weak
 *     `AnnotationRef.kind === 'index'` references survive a page
 *     reorder. This is the right semantic: when a user shuffles pages
 *     in the UI, their pending annotation edits must not silently
 *     break.
 *
 * The result therefore returns the new `pageOrder` directly. Callers
 * holding a previously-listed `PageListSnapshot` should swap it out for
 * `pageOrder` and re-render.
 */
export interface PageMoveResult {
  /**
   * The full post-move page order. `pageOrder[i].pageIndex === i` after
   * the engine refreshes its page registry. The `revision` and
   * `hasAnyWeakAnnotations` fields are unchanged from before the move
   * (the engine carries them over verbatim).
   */
  pageOrder: PageState[];
}
