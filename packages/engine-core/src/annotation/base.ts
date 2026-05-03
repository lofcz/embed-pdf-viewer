import type { AnnotationIdentityQuality } from '../identity/AnnotationIdentityQuality';
import type { AnnotationRef } from '../identity/AnnotationRef';
import type { PageObjectNumber } from '../identity/PageObjectNumber';
import type { AnnotationFlags, Rect } from './primitives';

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
  rect: Rect;
  /** /Contents text. */
  contents: string | null;
  /** /T author. */
  author: string | null;
  /** ISO 8601 from /CreationDate. */
  created: string | null;
  /** ISO 8601 from /M. */
  modified: string | null;
}
