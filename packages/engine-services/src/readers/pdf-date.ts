/**
 * Parse a PDF date string D:YYYYMMDDHHmmSSOHH'mm' to an ISO 8601 string.
 * Returns null if the input is malformed.
 *
 * The wire format always uses ISO 8601 strings; Date parsing is the
 * caller's job.
 */
export function pdfDateToIso(pdf: string): string | null {
  if (!pdf || !pdf.startsWith('D:') || pdf.length < 16) return null;

  const y = parseInt(pdf.slice(2, 6), 10);
  const mo = parseInt(pdf.slice(6, 8), 10) - 1;
  const d = parseInt(pdf.slice(8, 10), 10);
  const H = parseInt(pdf.slice(10, 12), 10);
  const M = parseInt(pdf.slice(12, 14), 10);
  const S = parseInt(pdf.slice(14, 16), 10);

  if ([y, mo, d, H, M, S].some((n) => Number.isNaN(n))) return null;

  const date = new Date(Date.UTC(y, mo, d, H, M, S));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
