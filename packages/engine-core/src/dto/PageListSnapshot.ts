import type { PageState } from '../revision/PageState';

/**
 * Read-only snapshot of every page in the open document, ordered by the
 * page's current `pageIndex`. Each `PageState` carries:
 *
 *   - `pageObjectNumber`: durable identity (stable across page reorder,
 *     insert, delete; the only safe key for cross-call correlation).
 *   - `pageIndex`: display order at the time of the read; **not** an
 *     identity, do not pass back as a ref.
 *   - `revision`: per-page generation token used for weak annotation ref
 *     liveness; intentionally untouched by `pages.move()`.
 *   - `weakAnnotationState`: whether the engine has actually scanned
 *     annotations for weak identities on this page.
 *   - `hasAnyWeakAnnotations`: compatibility mirror for local transient
 *     reads. Cacheable/cloud state must use `weakAnnotationState` and may
 *     only publish a boolean when it is `known`.
 */
export interface PageListSnapshot {
  pages: PageState[];
}
