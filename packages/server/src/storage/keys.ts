/**
 * Single source of truth for storage key construction.
 *
 * Layout (identical on FS / S3 / GCS / Azure):
 *
 *   <tenantId>/
 *     docs/
 *       <cd>/                     <- 2-char shard on docId for FS fanout
 *         <docId>/
 *           base.pdf              <- per-doc base PDF (Design A)
 *           layers/<name>/v<NNNN>.pdf
 *           events/<YYYY-MM>.jsonl
 *
 * Slashes are cosmetic on object stores; on FS they map to nested
 * directories. The 2-char shard prevents `ls <tenant>/docs/` from
 * blowing up at tens of millions of docs.
 *
 * `<cd>` is the first 2 hex chars of `docId`. We trust callers to
 * generate `docId`s with a uniform-ish prefix (UUID v4, ULID, our
 * own `doc_<base36>` helper all qualify).
 */

export const StorageKeys = {
  docRoot(tenantId: string, docId: string): string {
    return `${tenantId}/docs/${shard(docId)}/${docId}/`;
  },
  basePdf(tenantId: string, docId: string): string {
    return `${tenantId}/docs/${shard(docId)}/${docId}/base.pdf`;
  },
  /**
   * Layer version PDF. `version` is a 1-based monotonic integer. Stored
   * zero-padded for lexical sort and human readability. Not used in
   * Phase 1; lives here so the key shape is fixed up-front.
   */
  layerPdf(tenantId: string, docId: string, layerName: string, version: number): string {
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`layerPdf: version must be a positive integer, got ${version}`);
    }
    const padded = version.toString().padStart(4, '0');
    return `${tenantId}/docs/${shard(docId)}/${docId}/layers/${encodeURIComponent(layerName)}/v${padded}.pdf`;
  },
  /** Append-only event log, partitioned per calendar month. */
  eventsMonth(tenantId: string, docId: string, yearMonth: string): string {
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      throw new Error(`eventsMonth: bad YYYY-MM "${yearMonth}"`);
    }
    return `${tenantId}/docs/${shard(docId)}/${docId}/events/${yearMonth}.jsonl`;
  },
  tenantRoot(tenantId: string): string {
    return `${tenantId}/`;
  },
} as const;

function shard(docId: string): string {
  if (docId.length < 2) {
    throw new Error(`shard: docId too short (${docId})`);
  }
  return docId.slice(0, 2).toLowerCase();
}
