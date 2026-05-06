import type { AnnotationDTO } from '../annotation/kinds';
import type { AnnotationStableId } from '../identity/AnnotationStableId';
import type { AnnotationListMutationMeta } from './AnnotationListMutationMeta';

/**
 * Created annotation, fully materialised. The new annotation always has
 * `identityQuality === 'durable'` because the engine uses the
 * `EPDFPage_CreateAnnot` fork helper (which creates an indirect PDF
 * object) and reads it back via `EPDFPage_GetAnnotByObjectNumber`.
 */
export interface AnnotationCreateResult {
  created: AnnotationDTO;
  meta: AnnotationListMutationMeta;
}

export interface AnnotationUpdateResult {
  /**
   * The updated annotation, fully materialised after the patch.
   *
   * Note: `updated.ref` may be **stronger** than the input ref. If the
   * caller updated by `kind: 'index'` against a weak annotation (no /NM,
   * no indirect object number), the engine stamps a fresh
   * engine-generated UUID v4 as /NM during the update. The returned ref
   * will then be `kind: 'nm'`. This is non-structural (no revision bump,
   * no `shouldRefetch`); use `meta.changed[0]` (or `updated.ref`) to
   * update cache keys.
   *
   * /NM is monotonic per annotation:
   *   - if the annotation is already durable (has /NM or has objectNumber),
   *     the engine NEVER touches /NM during update;
   *   - if the annotation is weak, the engine always stamps a UUID v4.
   *
   * The /NM value is opaque to the engine. Callers that need a specific
   * id for tenant-side bookkeeping should set `draft.nm` at creation
   * time (the only place caller-supplied identity is accepted), or
   * maintain a Map<engine-id, tenant-id> on their side. There is
   * intentionally no `patch.nm` — a stable id that callers can rename
   * mid-session is not stable.
   */
  updated: AnnotationDTO;
  meta: AnnotationListMutationMeta;
}

export interface AnnotationDeleteResult {
  /**
   * Stable id of the annotation that was deleted. `null` for a weak
   * annotation (no objectNumber, no /NM): the engine refuses to fabricate
   * a stable id at delete time, so callers that targeted by index
   * receive `null` and must fall back to refetching the page list.
   */
  deleted: AnnotationStableId | null;
  meta: AnnotationListMutationMeta;
}
