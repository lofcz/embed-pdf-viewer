/**
 * PDF date string format conversion utilities.
 *
 * PDF stores timestamps as ASCII strings shaped like
 * `D:YYYYMMDDHHmmSSOHH'mm'`, where `O` is `+` / `-` / `Z` (Z means
 * UTC and omits the offset). See ISO 32000 §7.9.4.
 *
 * The wire format used by the engine DTOs is always ISO 8601;
 * readers convert PDF → ISO via {@link pdfDateToIso}, writers convert
 * the other way via {@link formatPdfDate}.
 */

/**
 * Parse a PDF date string `D:YYYYMMDDHHmmSSOHH'mm'` to an ISO 8601
 * string. Returns null if the input is malformed.
 *
 * Notes:
 *   - timezone parsing is intentionally simplified: the converter
 *     interprets the local fields as UTC and discards the trailing
 *     offset. This matches the pre-existing reader behaviour; PDF
 *     timezones are inconsistently populated in the wild so the
 *     conservative choice is "assume UTC" rather than guess.
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

/**
 * Format a JS Date as a PDF date string `D:YYYYMMDDHHmmSSOHH'mm'`.
 *
 * Emits the offset in PDF's funny `OHH'mm'` form, where the apostrophe
 * after the hour is literal and the offset always carries a sign. UTC
 * is emitted as `+00'00'` (not `Z`) for maximum reader compatibility —
 * the `Z` shorthand is allowed by the spec but not universally
 * supported.
 *
 * Always uses the supplied Date's local fields and offset. For
 * server-side stamps callers typically pass `new Date()` (default).
 */
export function formatPdfDate(d: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const tzMinutes = -d.getTimezoneOffset();
  const sign = tzMinutes >= 0 ? '+' : '-';
  const tzH = pad(Math.floor(Math.abs(tzMinutes) / 60));
  const tzM = pad(Math.abs(tzMinutes) % 60);
  return (
    `D:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` +
    `${sign}${tzH}'${tzM}'`
  );
}
