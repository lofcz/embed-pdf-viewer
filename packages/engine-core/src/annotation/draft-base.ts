/**
 * Generic fields every annotation Draft carries. These are not specific
 * to any subtype family; they map to PDF dictionary entries that exist
 * on every annotation per ISO 32000 §12.5.2 and may be authored at
 * create time.
 *
 * `nm` is here (and not in AnnotationPatchBase) because /NM seeds the
 * stable identity of a new annotation; it cannot be changed afterwards
 * without changing which annotation is being targeted.
 *
 * Authorial identity (/T author display, /EMBD_Metadata UserID and
 * GroupID) is set by the server from the caller's JWT identity at
 * creation — the worker writes /T from the caller's `display_name`
 * claim and /EMBD_Metadata from the caller's `user_id` / `group_id`
 * claims. The `doc.annotate.create` capability is the gate.
 */
export interface AnnotationDraftBase {
  contents?: string | null;
  /** Optional /NM the caller wants to assign on creation. */
  nm?: string;
}
