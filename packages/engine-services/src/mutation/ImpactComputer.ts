import type {
  AnnotationListMutationMeta,
  AnnotationStableId,
  PageState,
} from '@embedpdf/engine-core';

/**
 * The kind of mutation that just happened on a page. `update` is
 * non-structural by definition: indices and the annotation array on the
 * page are unchanged, so weak (`kind: 'index'`) refs the client may be
 * holding stay valid. `create` and `delete` are both structural.
 */
export type MutationKind = 'create' | 'update' | 'delete';

/**
 * Inputs that decide whether a mutation should make a client refetch.
 *
 *   `pageStateBefore` is captured BEFORE the mutation. Its
 *   `hasAnyWeakAnnotations` flag drives the locked rule:
 *     structural mutation × any weak annotation on the page  ⇒  refetch.
 *
 *   `pageStateAfter` is captured AFTER the mutation. It carries the
 *   bumped revision token (for structural ops) and the recomputed
 *   `hasAnyWeakAnnotations` flag (for any op that might have changed
 *   it, e.g. opportunistic /NM stamping during update).
 *
 *   `changed` is the list of stable ids the mutation actually touched.
 *   Empty for a weak delete (we have no durable id to report).
 */
export interface ImpactInputs {
  mutation: MutationKind;
  pageStateBefore: PageState;
  pageStateAfter: PageState;
  changed: AnnotationStableId[];
}

/**
 * Static helper: turn a mutation outcome into the side-effect envelope
 * every result type carries on its `meta` field.
 *
 * The rules — locked with the user, do not change without re-reading the
 * doc comment on `AnnotationListMutationMeta`:
 *
 *   1. `update` is never structural. Indices on the page do not move,
 *      so weak refs the client may be holding stay valid. Opportunistic
 *      /NM stamping during an update is also non-structural — it does
 *      not change the annotation's position, only its identity quality.
 *      `weakRefsInvalidated = false`, `shouldRefetch = null`.
 *
 *   2. `create` and `delete` are structural. They DO move indices:
 *        - `create` appends a new annotation, growing the array.
 *        - `delete` removes an annotation, shifting every later index
 *          down by one.
 *      But that only matters if the page actually had any weak refs
 *      *before* the mutation — if every annotation already had a durable
 *      identity, no client could possibly be holding a stale index, and
 *      we keep `shouldRefetch = null`.
 *
 *   3. When rule (2) fires, the reason is always `'weakRefsInvalidated'`.
 *      `'pageRebuilt'` and `'externalChange'` are reserved for higher-
 *      level signals the engine doesn't emit yet (page reorders, watch-
 *      based refresh).
 */
export class ImpactComputer {
  static compute(inputs: ImpactInputs): AnnotationListMutationMeta {
    const { mutation, pageStateBefore, pageStateAfter, changed } = inputs;

    if (mutation === 'update') {
      return {
        pageState: pageStateAfter,
        changed,
        weakRefsInvalidated: false,
        shouldRefetch: null,
      };
    }

    // create / delete: structural.
    const hadWeakBefore = pageStateBefore.hasAnyWeakAnnotations;
    return {
      pageState: pageStateAfter,
      changed,
      weakRefsInvalidated: hadWeakBefore,
      shouldRefetch: hadWeakBefore ? { reason: 'weakRefsInvalidated' } : null,
    };
  }
}
