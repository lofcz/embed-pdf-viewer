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

  /**
   * Explicit /EMBD_Metadata identity overrides for impersonation /
   * cross-group authoring.
   *
   * When ABSENT, the server fills both from the caller's JWT identity
   * (`user_id` and `group_id` claims) — the typical case where the
   * caller is creating annotations as themselves in their default
   * group.
   *
   * When PRESENT, the server uses these values for the collab check
   * (so `annotations:create:self` / `:createdBy=X` / `:group=Y` all
   * evaluate against the supplied identity) AND for the worker's
   * /EMBD_Metadata stamp. A caller needs:
   *   - `annotations:create:<filter>` matching the effective target, AND
   *   - if `groupId` differs from the caller's JWT default,
   *     `annotations:set-group:all` or `annotations:set-group:group=<groupId>`
   * Otherwise the route returns 403.
   *
   * Use cases: admin/moderator creating annotations attributed to a
   * specific user; migration tools preserving original authorship;
   * workflow bots tagging into specific groups.
   */
  userId?: string;
  groupId?: string;
}
