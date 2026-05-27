/**
 * Closed enum of capability scopes. Any scope string not in this set (and
 * not a wildcard, virtual, or collab scope) is rejected at parse time.
 *
 * Bit references in comments are documentation of how `pdf.permissions`
 * expands these capabilities. PDF bits are NEVER consulted unless
 * `pdf.permissions` is in scope.
 */
export type DocCapability =
  // Session establishment (cloud-only — no PDF bit)
  | 'doc.open' // /head, /manifest, /access
  | 'doc.render' // /pages/*/render

  // Text/content extraction (PDF bit 5)
  | 'doc.text.select' // /pages/*/geometry
  | 'doc.text.copy' // /pages/*/text
  | 'doc.text.search' // reserved for future /pages/*/search@*
  | 'doc.content.copy' // graphics/image extraction (reserved)

  // Output (cloud-only download capabilities)
  | 'doc.download'
  | 'doc.download.flattened'

  // Print (PDF bit 3 / bit 12)
  | 'doc.print'
  | 'doc.print.high'

  // Page-level mutation (PDF bit 4 / bit 11)
  | 'doc.pages.modify'
  | 'doc.pages.assemble'

  // Forms (PDF bit 6 / bit 9)
  | 'doc.forms.fill'
  | 'doc.forms.modify'

  // Annotations
  | 'doc.annotate.read' // cloud-only read of annotation lists (PDF bit 6 in pdf.permissions)
  | 'doc.annotate.create' // create new annotations stamped with the caller's identity (PDF bit 6)
  | 'doc.annotate.modify' // broad write incl. update/delete (bypasses per-record collab filters) (PDF bit 6)

  // Redaction apply (destructive content modification, PDF bit 4)
  | 'doc.redact';

/**
 * Single-entity collaboration vocabulary. Only annotations are
 * collab-scoped today; future entities slot into the same grammar.
 */
export type CollabEntity = 'annotations';

/**
 * Collab actions describe operations against an existing annotation row
 * whose owner identity may differ from the caller. Creation is gated by
 * the `doc.annotate.create` capability — it always stamps the caller's
 * JWT identity and has no other-target dimension to qualify.
 */
export type CollabAction = 'update' | 'delete' | 'set-group';

export type CollabFilter =
  | { kind: 'all' }
  | { kind: 'self' }
  | { kind: 'createdBy'; userId: string }
  | { kind: 'group'; groupId: string };

export interface ParsedCapability {
  kind: 'capability';
  name: DocCapability;
}

export interface ParsedCollab {
  kind: 'collab';
  entity: CollabEntity;
  action: CollabAction | '*';
  filter: CollabFilter;
}

export interface ParsedVirtual {
  kind: 'virtual';
  name: 'pdf.permissions';
}

export interface ParsedWildcard {
  kind: 'wildcard';
}

export type ParsedScope = ParsedCapability | ParsedCollab | ParsedVirtual | ParsedWildcard;

/**
 * Typed boolean view of the PDF user-access permission word.
 *
 * Names mirror ISO 32000 bit positions (bit3 = print, bit4 = modify, etc.).
 * Use {@link DecodePdfBits} (in pdf-bits.ts) to build this from the integer
 * stored in the documents row.
 */
export interface PdfBits {
  bit3: boolean; // print
  bit4: boolean; // modify
  bit5: boolean; // copy/extract
  bit6: boolean; // annotate + fill forms
  bit9: boolean; // fill existing forms
  bit10: boolean; // accessibility (deprecated in PDF 2.0)
  bit11: boolean; // assemble
  bit12: boolean; // high-quality print
}

/**
 * Identity claims associated with a JWT (cloud) or supplied at engine
 * open time (local). Used by collab filter resolution and by annotation
 * authoring (populating /T and /EMBD_Metadata fields).
 */
export interface IdentityClaims {
  user_id?: string;
  group_id?: string;
  groups?: ReadonlyArray<string>;
  display_name?: string;
}

/**
 * Subset of identity claims that flows into worker requests so the
 * annotation pipeline can stamp /T, /M, and /EMBD_Metadata on writes.
 *
 * Field names follow PDF/EMBD conventions (UserID, GroupID) rather than
 * the JWT-style snake_case used by IdentityClaims.
 */
export interface AnnotationActor {
  userId?: string;
  groupId?: string;
  displayName?: string;
}
