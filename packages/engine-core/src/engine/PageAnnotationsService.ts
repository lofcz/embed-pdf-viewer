import { AbortablePromise } from '../promise/AbortablePromise';
import type { AnnotationDraft, AnnotationPatch } from '../annotation/kinds';
import type { AnnotationListPageSnapshot } from '../annotation/AnnotationListSnapshot';
import type { AnnotationRef } from '../identity/AnnotationRef';
import type {
  AnnotationCreateResult,
  AnnotationDeleteResult,
  AnnotationMoveResult,
  AnnotationUpdateResult,
} from '../mutation/AnnotationMutationResults';

/**
 * Per-page annotation service exposed via `PageHandle.annotations`.
 *
 * `list()` is the slow path: the engine acquires a `pagePtr` from the
 * `PagePtrPool`, dispatches per-subtype readers, and returns
 * fully-typed annotations. Mutations all funnel through this service
 * because they need a `pagePtr` anyway.
 *
 * Mutation methods are typed in this slice but throw
 * `EngineError(NotImplemented)` until the next slice. The signatures are
 * stable so client code can be written against them today.
 */
export interface PageAnnotationsService {
  list(): AbortablePromise<AnnotationListPageSnapshot>;
  create(draft: AnnotationDraft): AbortablePromise<AnnotationCreateResult>;
  update(ref: AnnotationRef, patch: AnnotationPatch): AbortablePromise<AnnotationUpdateResult>;
  delete(ref: AnnotationRef): AbortablePromise<AnnotationDeleteResult>;
  /**
   * Batch move (contiguous-block; `refs.length === 1` is the
   * single-annotation case). Refs may mix stable ids and weak `index`
   * refs; weak refs are opportunistically upgraded to durable `/NM`
   * before the move (same rule as `update()`). Atomic — one revision
   * bump and one impact computation per batch.
   *
   * @param refs Annotations to move, in the order they should appear
   *             after the move.
   * @param toIndex Insertion point in the post-removal /Annots index
   *                space, in `[0, count - refs.length]`.
   */
  move(refs: AnnotationRef[], toIndex: number): AbortablePromise<AnnotationMoveResult>;
}
