import type { MutationMeta } from './MutationMeta';

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
 * The result therefore returns the new state order via
 * `meta.affectedPages`. Callers holding a previously-listed
 * `PageListSnapshot` should swap it out for `meta.affectedPages` and
 * re-render.
 */
export interface PageMoveResult {
  /** Cache-key delta for cloud clients; `null` for local engines. */
  meta: MutationMeta;
}
