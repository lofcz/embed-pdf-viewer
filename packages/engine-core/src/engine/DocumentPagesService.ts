import type { PageListSnapshot } from '../dto/PageListSnapshot';
import type { PdfRotation } from '../geometry/primitives';
import type { PageObjectNumber } from '../identity/PageObjectNumber';
import type { PageDeleteResult } from '../mutation/PageDeleteResult';
import type { PageMoveResult } from '../mutation/PageMoveResult';
import type { PageRotateResult } from '../mutation/PageRotateResult';
import { AbortablePromise } from '../promise/AbortablePromise';

/**
 * Document-scoped page service exposed via `DocumentHandle.pages`.
 *
 * Mirrors the shape of `DocumentAnnotationsService` so that anything
 * touching "many things at the document level" lives in one place. The
 * structure verbs are `move`, `rotate`, and `delete`; the surface is
 * designed for `insert` to slot in without API churn.
 *
 * Identity rule: pages are addressed by indirect `pageObjectNumber`
 * everywhere except `list()`, which exposes display order through
 * `PageState.pageIndex`. There is no "weak page ref" model — structure
 * verbs therefore do not bump per-page revisions and do not invalidate
 * any in-flight annotation refs on surviving pages.
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

  /**
   * Set the ABSOLUTE display rotation of the supplied pages (one value
   * for all — the multi-select thumbnail gesture). Pure presentation
   * metadata: content coordinates are normalized, so cached renders,
   * annotation refs, and `RevisionToken`s all survive untouched. See
   * `PageRotateInput` for why the wire is absolute, never relative.
   */
  rotate(
    pageObjectNumbers: PageObjectNumber[],
    rotation: PdfRotation,
  ): AbortablePromise<PageRotateResult>;

  /**
   * Delete pages. Deleting every page is rejected (`InvalidArg`) — a
   * document must keep at least one. Deleted PONs are retired, never
   * recycled; surviving pages keep their identity and revisions.
   */
  delete(pageObjectNumbers: PageObjectNumber[]): AbortablePromise<PageDeleteResult>;
}
