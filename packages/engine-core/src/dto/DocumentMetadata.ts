export type DocumentMetadataTrapped = 'true' | 'false' | 'unknown';

export interface DocumentMetadata {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  producer: string | null;
  creator: string | null;
  /** ISO 8601 string. Date parsing is the caller's job. */
  creationDate: string | null;
  /** ISO 8601 string. Date parsing is the caller's job. */
  modificationDate: string | null;
  trapped: DocumentMetadataTrapped;
  custom: Record<string, string>;
}
