/**
 * Page-pill field: digits only, empty while typing, overflow clamped to
 * `total`. Commit restores the current page on empty and clamps to 1…total.
 */

/** Marker interpolated into `demo.page` so the current-page slot can host an input. */
export const PAGE_CURRENT_MARKER = '\u0001';

export function splitPageLabel(
  label: string,
  marker: string = PAGE_CURRENT_MARKER,
): { lead: string; tail: string } {
  const at = label.indexOf(marker);
  if (at < 0) return { lead: label, tail: '' };
  return { lead: label.slice(0, at), tail: label.slice(at + marker.length) };
}

/** Accept a keystroke. `null` rejects it (non-digits). Empty stays empty. */
export function acceptPageDraft(raw: string, total: number): string | null {
  if (raw === '') return '';
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (n > total) return String(total);
  return raw;
}

/** Resolve a draft to a 1-based page. Empty / unusable → `fallback`. */
export function commitPageDraft(raw: string, total: number, fallback: number): number {
  if (raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(total, Math.max(1, Math.trunc(n)));
}
