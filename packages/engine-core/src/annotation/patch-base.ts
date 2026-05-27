/**
 * Generic fields every annotation Patch carries. Same set as
 * AnnotationDraftBase, minus `nm` (identity is immutable; clients
 * target an existing annotation via AnnotationRef instead).
 *
 * Three-state semantics on string|null fields:
 *   undefined -> don't touch
 *   null      -> clear the field
 *   "..."     -> set to this value
 */
export interface AnnotationPatchBase {
  contents?: string | null;
  author?: string | null;

  /**
   * Reassign the annotation's `/EMBD_Metadata/GroupID`.
   *
   * `userId` is intentionally NOT patchable — `/EMBD_Metadata/UserID`
   * and `/CreatedBy` are bound at annotation creation time and remain
   * immutable for the lifetime of the annotation. `/UpdatedBy` always
   * refreshes from the caller's identity on every update.
   *
   * When `groupId` is supplied and differs from the annotation's
   * current `/EMBD_Metadata/GroupID`, the route runs `checkSetGroup`
   * against the caller's scope; 403 if denied.
   *
   * Three-state on string|null fields (`contents`, `author`):
   *   undefined → don't touch
   *   null      → clear the field
   *   "..."     → set to this value
   *
   * `groupId` does not support the `null` clear-form — group attribution
   * is either present or absent, and the only mutation is "reassign to
   * a different group."
   */
  groupId?: string;
}
