import type { PageListSnapshot } from '../dto/PageListSnapshot';

/**
 * Cloud-only coherence pins returned by a page move so a cached manifest can
 * advance without a refetch. A move is a structural op: it bumps the manifest
 * `docVersion` and the geometry pointer `layoutVersion`, but touches no
 * per-page content/annotation pins (those caches stay warm).
 *
 * `previousDocVersion` makes the patch safe to apply: a client only advances
 * its cached manifest when it is exactly at that version, otherwise it
 * refreshes instead of manufacturing a mixed-version manifest. `null` on the
 * result for local engines (no manifest/CDN).
 */
export interface PageMoveCache {
  previousDocVersion: number;
  docVersion: number;
  layoutVersion: number;
}

/**
 * Result of a `pages.move()`. Page reorder is intentionally **outside** the
 * per-page revision/weak-ref model, so a move returns geometry, not liveness:
 *
 *   - Pages are always identified by `pageObjectNumber`; there is no "weak
 *     page ref", so no revision needs bumping to invalidate caller state.
 *   - Per-page `RevisionToken`s are NOT bumped on a move — each page's
 *     /Annots array is untouched, so weak `AnnotationRef.kind === 'index'`
 *     references survive a reorder. (That liveness invariant is verified by
 *     the annotation conformance suite, not here.)
 *
 * What a move actually changes is the page order + geometry, so the result
 * returns the new `layout` (the same shape `pages.list()` returns). Callers
 * holding a previously-listed `PageListSnapshot` swap it for `result.layout`
 * and re-render.
 */
export interface PageMoveResult {
  /** The new page order + geometry — what a move changes. */
  layout: PageListSnapshot;
  /** Cloud-only manifest coherence pins; `null` for local engines. */
  cache: PageMoveCache | null;
}
