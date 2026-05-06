import { AbortablePromise } from '../promise/AbortablePromise';
import type { PageObjectNumber } from '../identity/PageObjectNumber';
import type { PageListSnapshot } from '../dto/PageListSnapshot';
import type { PageMoveResult } from '../mutation/PageMoveResult';

/**
 * Document-scoped page service exposed via `DocumentHandle.pages`.
 *
 * Mirrors the shape of `DocumentAnnotationsService` so that anything
 * touching "many things at the document level" lives in one place. The
 * service is intentionally narrow today — `list` and `move` only — but
 * the surface is designed for `insert`, `delete`, and `rotate` to slot
 * in without API churn.
 *
 * Identity rule: pages are addressed by indirect `pageObjectNumber`
 * everywhere except `list()`, which exposes display order through
 * `PageState.pageIndex`. There is no "weak page ref" model — `move()`
 * therefore does not bump per-page revisions and does not invalidate
 * any in-flight annotation refs.
 */
export interface DocumentPagesService {
  /**
   * Snapshot of every page in display order. Cheap; never acquires a
   * `pagePtr`.
   */
  list(): AbortablePromise<PageListSnapshot>;

  /**
   * Reorder pages. The supplied pages are detached and re-inserted as
   * a contiguous block starting at `destIndex` in the post-removal
   * index space, preserving caller order. Per-page `RevisionToken`s
   * survive — index-based annotation refs the caller is holding remain
   * valid across a page reorder.
   *
   * @param pageObjectNumbers Pages to move, in the order they should
   *                          appear after the move.
   * @param destIndex Insertion point in `[0, pageCount - len]`.
   */
  move(pageObjectNumbers: PageObjectNumber[], destIndex: number): AbortablePromise<PageMoveResult>;
}
