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
}
