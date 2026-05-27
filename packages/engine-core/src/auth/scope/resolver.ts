import { parseScope } from './parser';
import type {
  CollabAction,
  CollabFilter,
  DocCapability,
  IdentityClaims,
  ParsedScope,
  PdfBits,
} from './types';

/**
 * Resolved collab subject — the per-record identity bits used to test
 * collab filters against. Sourced from the target record's stored
 * `/EMBD_Metadata/UserID` and `/GroupID` at mutation time.
 */
export interface CollabTarget {
  userId?: string;
  groupId?: string;
}

/**
 * True iff the given capability is granted by the scope array plus the
 * PDF bits visible via `pdf.permissions` expansion.
 *
 * Wildcard `*` short-circuits to true. Anything not explicitly granted
 * (or expanded from `pdf.permissions`) is denied.
 */
export function checkCapability(
  capability: DocCapability,
  rawScope: ReadonlyArray<string>,
  pdfBits: PdfBits,
): boolean {
  const parsed = rawScope.map(parseScope);
  if (parsed.some((s) => s.kind === 'wildcard')) return true;
  return expandedCapabilities(parsed, pdfBits).has(capability);
}

/**
 * True iff the scope grants AT LEAST ONE of `capabilities`. Convenience
 * for routes like `/text` (`doc.text.copy` OR `doc.text.search`) and
 * `/geometry` (`doc.text.select` OR `doc.text.search`).
 */
export function checkAnyCapability(
  capabilities: ReadonlyArray<DocCapability>,
  rawScope: ReadonlyArray<string>,
  pdfBits: PdfBits,
): boolean {
  return capabilities.some((c) => checkCapability(c, rawScope, pdfBits));
}

/**
 * True iff the scope grants the collab action against the target record.
 *
 * Resolution order:
 *   1. wildcard `*` → true
 *   2. `doc.annotate.modify` (explicit or via `pdf.permissions`) → true
 *      (broad write capability bypasses per-record filters)
 *   3. any collab scope whose action matches AND whose filter matches
 *      the target/identity → true
 *   4. otherwise → false
 */
export function checkCollab(
  action: CollabAction,
  target: CollabTarget,
  rawScope: ReadonlyArray<string>,
  identity: IdentityClaims,
  pdfBits: PdfBits,
): boolean {
  const parsed = rawScope.map(parseScope);
  if (parsed.some((s) => s.kind === 'wildcard')) return true;

  if (expandedCapabilities(parsed, pdfBits).has('doc.annotate.modify')) return true;

  for (const s of parsed) {
    if (s.kind !== 'collab') continue;
    if (s.action !== '*' && s.action !== action) continue;
    if (filterMatches(s.filter, target, identity)) return true;
  }
  return false;
}

/**
 * Compute the full set of granted capabilities after expanding
 * `pdf.permissions` and applying implication rules.
 *
 * Implications applied:
 *   - `doc.annotate.modify` implies `doc.annotate.read`
 *     (can't sensibly modify what you can't see)
 *   - any annotation collab scope implies `doc.annotate.read`
 *     (mutation routes need to see the target row first)
 *
 * Does NOT short-circuit on wildcard — callers do that themselves
 * before calling this. Returning the expanded set is useful for the
 * `/access` response's `effectiveScope` and for advisory UI surfacing.
 */
export function expandedCapabilities(
  parsed: ReadonlyArray<ParsedScope>,
  pdfBits: PdfBits,
): Set<DocCapability> {
  const out = new Set<DocCapability>();
  let hasAnnotationCollab = false;

  for (const s of parsed) {
    if (s.kind === 'capability') {
      out.add(s.name);
    } else if (s.kind === 'virtual' && s.name === 'pdf.permissions') {
      addPdfPermissions(out, pdfBits);
    } else if (s.kind === 'collab' && s.entity === 'annotations') {
      hasAnnotationCollab = true;
    }
  }

  // Implications (apply after the explicit additions above)
  if (out.has('doc.annotate.modify')) out.add('doc.annotate.read');
  if (hasAnnotationCollab) out.add('doc.annotate.read');

  return out;
}

/**
 * Convenience wrapper: takes the raw scope array, parses each entry,
 * returns the expanded capability set. Exposed for the `/access`
 * endpoint and for the SDK helper that surfaces `effectiveScope`.
 */
export function expandRawScope(
  rawScope: ReadonlyArray<string>,
  pdfBits: PdfBits,
): Set<DocCapability> {
  return expandedCapabilities(rawScope.map(parseScope), pdfBits);
}

/**
 * Test a single collab filter against a target record + the caller's
 * identity. Pure function — no side effects, no implicit rules.
 *
 *   all              → always matches
 *   self             → matches if identity.user_id === target.userId
 *   createdBy=<X>    → matches if target.userId === X
 *   group=<X>        → matches if target.groupId === X
 *                      AND identity.groups includes X
 *
 * The group-membership check on `group=X` prevents a token from
 * matching annotations in a group it doesn't belong to, even if the
 * target row carries that groupId.
 */
/**
 * Authority to assign a specific groupId to an annotation.
 *
 * Fires ONLY when the caller is setting groupId to something other than
 * their JWT-default `group_id`. The "set-group is just about group
 * assignment authority" semantic is independent from create/update/delete
 * collab — a user might be allowed to create annotations (via collab
 * filter) but not allowed to assign them to a non-default group (without
 * a separate `annotations:set-group:*` grant).
 *
 * Resolution order:
 *   1. wildcard `*` → true
 *   2. newGroupId === callerDefaultGroupId → true (no group-assignment
 *      authority needed; the annotation gets the caller's default group)
 *   3. `annotations:set-group:all` → true
 *   4. `annotations:set-group:group=<newGroupId>` → true
 *   5. `annotations:*:all` or `annotations:*:group=<newGroupId>` → true
 *      (action wildcard includes set-group)
 *   6. otherwise → false
 *
 * Note: this is intentionally independent from membership. A user with
 * `set-group:group=legal` can assign annotations to the legal group
 * even if they're not a member — that's the whole point.
 */
export function checkSetGroup(
  newGroupId: string,
  callerDefaultGroupId: string | undefined,
  rawScope: ReadonlyArray<string>,
  pdfBits: PdfBits,
): boolean {
  // No authority needed when the caller is assigning their default group.
  if (newGroupId === callerDefaultGroupId) return true;

  const parsed = rawScope.map(parseScope);
  if (parsed.some((s) => s.kind === 'wildcard')) return true;

  // doc.annotate.modify is the broad annotation-write capability and
  // bypasses collab filters (existing rule); apply the same bypass to
  // set-group so admin-style tokens behave consistently across all
  // annotation-mutating concerns.
  if (expandedCapabilities(parsed, pdfBits).has('doc.annotate.modify')) return true;

  for (const s of parsed) {
    if (s.kind !== 'collab') continue;
    if (s.entity !== 'annotations') continue;
    if (s.action !== 'set-group' && s.action !== '*') continue;
    if (s.filter.kind === 'all') return true;
    if (s.filter.kind === 'group' && s.filter.groupId === newGroupId) return true;
    // :self and :createdBy are rejected at parse time for set-group, so
    // they never appear here. The action-wildcard path could carry those
    // filters legitimately for other actions — silently skip those, they
    // can't satisfy a set-group check.
  }
  return false;
}

export function filterMatches(
  filter: CollabFilter,
  target: CollabTarget,
  id: IdentityClaims,
): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'self':
      return !!id.user_id && target.userId === id.user_id;
    case 'createdBy':
      return target.userId === filter.userId;
    case 'group':
      return target.groupId === filter.groupId && (id.groups?.includes(filter.groupId) ?? false);
  }
}

/**
 * Translate `pdf.permissions` (virtual scope) into the concrete
 * capabilities it represents under the current PDF bit configuration.
 *
 * Always adds `doc.open` and `doc.render` — these are cloud-only
 * capabilities with no PDF bit, but `pdf.permissions` is meant to be
 * the "give the user a working session" shorthand. Without them, a
 * token with just `['pdf.permissions']` would be useless.
 *
 * Bit-derived expansions follow ISO 32000:
 *   bit 5   → doc.text.{select, copy, search}, doc.content.copy
 *   bit 3   → doc.print
 *   bit 12  → doc.print.high (requires bit 3 also set)
 *   bit 4   → doc.pages.modify, doc.redact
 *   bit 11  → doc.pages.assemble
 *   bit 6   → doc.annotate.read, doc.annotate.modify
 *   bit 6/9 → doc.forms.fill
 *   bit 6+4 → doc.forms.modify
 *
 * Note: this same expansion lives in builders.ts as
 * `materializePdfPermissions` for SDK-side use. The two MUST stay in
 * sync; a test in resolver.test.ts pins them together.
 */
function addPdfPermissions(out: Set<DocCapability>, b: PdfBits): void {
  // Always — pdf.permissions means "give me a working session"
  out.add('doc.open');
  out.add('doc.render');

  if (b.bit5) {
    out.add('doc.text.select');
    out.add('doc.text.copy');
    out.add('doc.text.search');
    out.add('doc.content.copy');
  }
  if (b.bit3) out.add('doc.print');
  if (b.bit12 && b.bit3) out.add('doc.print.high');
  if (b.bit4) {
    out.add('doc.pages.modify');
    out.add('doc.redact');
  }
  if (b.bit11) out.add('doc.pages.assemble');
  if (b.bit6) {
    out.add('doc.annotate.read');
    out.add('doc.annotate.modify');
  }
  if (b.bit6 || b.bit9) out.add('doc.forms.fill');
  if (b.bit6 && b.bit4) out.add('doc.forms.modify');
}
