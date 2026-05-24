import type { PageState } from '../revision/PageState';

/**
 * Per-page text snapshot returned by `PageHandle.text.read()` and over
 * the wire as the `GET /v1/docs/:docId/pages/:pon/text@contentVersion=N` body.
 *
 * `pageState` carries the same identity envelope every page-scoped read
 * returns (pageObjectNumber, pageIndex, revision, weak-annotation flag),
 * so callers can pin subsequent operations to the same revision.
 *
 * `text` is the full plain-text extraction of the page in display order
 * (UTF-16 → JS string). `charCount` is the PDFium-reported character
 * count and may differ from `text.length` when the page contains
 * astral-plane characters (PDFium counts UTF-16 code units, and JS
 * strings preserve them as surrogate pairs).
 *
 * Future extensions (per-character bounding boxes, font runs, search
 * results, etc.) land on `PageTextService` as additional methods; the
 * snapshot shape stays stable so the wire URL and CDN cache remain
 * intact across SDK versions.
 */
export interface PageTextSnapshot {
  pageState: PageState;
  text: string;
  charCount: number;
}
