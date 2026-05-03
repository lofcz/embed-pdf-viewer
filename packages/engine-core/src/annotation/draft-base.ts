/**
 * Generic fields every annotation Draft carries. These are not specific
 * to any subtype family; they map to PDF dictionary entries that exist
 * on every annotation per ISO 32000 §12.5.2 and may be authored at
 * create time.
 *
 * `nm` is here (and not in AnnotationPatchBase) because /NM seeds the
 * stable identity of a new annotation; it cannot be changed afterwards
 * without changing which annotation is being targeted.
 */
export interface AnnotationDraftBase {
  contents?: string | null;
  author?: string | null;
  /** Optional /NM the caller wants to assign on creation. */
  nm?: string;
}
