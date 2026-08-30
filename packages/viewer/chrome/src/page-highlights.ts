/**
 * 1-based inclusive page ranges — the citation / deep-link mark list the
 * thumbnail rail paints. Kept as ranges (never expanded) so a malformed or
 * enormous span cannot allocate a large array in the viewer.
 */
export interface HighlightedPageRange {
  start: number;
  end: number;
}

/** 0-based page index → whether it sits in any 1-based highlight range. */
export function pageIndexIsHighlighted(
  pageIndex: number,
  ranges: readonly HighlightedPageRange[] | undefined,
): boolean {
  if (!ranges?.length || !Number.isInteger(pageIndex) || pageIndex < 0) return false;
  const page = pageIndex + 1;
  for (const range of ranges) {
    if (page >= range.start && page <= range.end) return true;
  }
  return false;
}

/** 0-based index of the first page of the first range, or null. */
export function firstHighlightedPageIndex(
  ranges: readonly HighlightedPageRange[] | undefined,
): number | null {
  const start = ranges?.[0]?.start;
  if (!Number.isInteger(start) || (start as number) < 1) return null;
  return (start as number) - 1;
}
