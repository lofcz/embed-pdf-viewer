import type { AnnotationFlags } from './primitives';
import type { PdfRect } from '../geometry/primitives';
import type { AnnotationIdentityQuality } from '../identity/AnnotationIdentityQuality';
import type { AnnotationRef } from '../identity/AnnotationRef';
import type { PageObjectNumber } from '../identity/PageObjectNumber';

/**
 * Identity + provenance shell every annotation DTO extends.
 *
 * No subtype-specific fields. Each subtype's DTO under `annotation/kinds/`
 * extends this with exactly the fields it needs and the `subtype` literal
 * discriminator. This shell never grows when a new subtype lands.
 */
export interface AnnotationBase {
  ref: AnnotationRef;
  pageObjectNumber: PageObjectNumber;
  /** Display order inside the page; 0-based. */
  index: number;
  identityQuality: AnnotationIdentityQuality;
  /** /NM if present, exposed read-only. The engine never auto-stamps it. */
  nm: string | null;
  flags: AnnotationFlags;
  rect: PdfRect;
  /** /Contents text. */
  contents: string | null;
  /** /T author. */
  author: string | null;
  /** ISO 8601 from /CreationDate. */
  created: string | null;
  /** ISO 8601 from /M. */
  modified: string | null;

  /**
   * EmbedPDF-namespaced /EMBD_Metadata fields, when present on the
   * annotation. These are written by the cloud annotation pipeline (and
   * by engine-local when an identity is supplied at open time) so the
   * client can resolve collab semantics and author display.
   *
   * Absence means either:
   *   - the annotation was created before EMBD_Metadata was wired up,
   *   - it was created by a non-cloud writer (Acrobat, Foxit, etc.),
   *   - or the writer ran without an actor (anonymous test fixtures).
   *
   * Collab filters in the resolver treat absent userId/groupId as
   * not-self / not-in-group — i.e. deny — so unstamped annotations are
   * invisible to per-record collab rules. They are still visible to
   * `view:all` style reads, since reads aren't filtered (per the v1
   * spec).
   */
  userId?: string;
  groupId?: string;
  createdBy?: string;
  updatedBy?: string;
}
