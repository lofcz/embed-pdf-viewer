/**
 * Generic fields every annotation Patch carries.
 *
 * Three-state semantics on string|null fields:
 *   undefined -> don't touch
 *   null      -> clear the field
 *   "..."     -> set to this value
 *
 * Authorial identity is immutable after create:
 *
 *   - `/EMBD_Metadata/UserID` and `/CreatedBy` are bound at creation
 *     and cannot be patched. `/EMBD_Metadata/UpdatedBy` is refreshed by
 *     the server from the caller's identity on every update.
 *   - `/T` (the standard PDF "author" display field) is bound at
 *     creation from the caller's JWT `display_name` and cannot be
 *     patched. Acrobat and other viewers display /T as "author", so
 *     allowing edits would let any caller with update authority
 *     rewrite who appears to have authored the annotation.
 *
 * `groupId` IS patchable — organizational ownership (which team an
 * annotation belongs to) can legitimately change with reorgs /
 * handoffs. Reassignment runs `checkSetGroup` against the caller's
 * scope.
 */
export interface AnnotationPatchBase {
  contents?: string | null;

  /**
   * Reassign the annotation's `/EMBD_Metadata/GroupID`.
   *
   * When supplied and differs from the annotation's current GroupID,
   * the route runs `checkSetGroup` against the caller's scope; 403 if
   * denied. `groupId` does not support a `null` clear-form — group
   * attribution is either present or absent, and the only mutation is
   * "reassign to a different group."
   */
  groupId?: string;
}
