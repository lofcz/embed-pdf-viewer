import type { PageObjectNumber } from '../identity/PageObjectNumber';

/**
 * A raw PDF page box in PDF user space, as `[llx, lly, urx, ury]`
 * (lower-left and upper-right corners). Coordinates are NOT rotated and
 * NOT origin-normalized; they are the page dictionary's box exactly as the
 * PDF declares it (MediaBox may have a non-zero origin). The display
 * transform (origin shift, Y-flip, rotation) lives in the SDK, never here.
 */
export type PdfRect = [llx: number, lly: number, urx: number, ury: number];

/**
 * The five PDF page boundary boxes. `media` and `crop` are always present
 * (`crop` defaults to `media` when the PDF omits it — the viewer always
 * needs an effective crop). `bleed`, `trim`, and `art` are present only
 * when the PDF actually declares them.
 */
export interface PageBoxes {
  media: PdfRect;
  crop: PdfRect;
  bleed?: PdfRect;
  trim?: PdfRect;
  art?: PdfRect;
}

/**
 * Pure geometry for one page. This is the per-page element returned by
 * `pages.list()`. It carries NO annotation liveness (`revision`,
 * `weakAnnotationState`) — that lives on annotation reads and the cloud
 * manifest only.
 *
 * `width`/`height` are the UN-rotated crop dimensions (from
 * `EPDF_GetPageSizeByIndexNormalized`, which does not swap for rotation).
 * `rotation` is a separate field; the SDK swaps width/height for 90/270 to
 * derive the on-screen display size. Keeping the wire un-rotated keeps it
 * consistent with the raw `boxes` and with the "transform lives in the SDK"
 * principle.
 */
/** A page's display rotation in degrees clockwise — the `/Rotate` values PDF
 *  permits. Presentation metadata only: content coordinates stay normalized. */
export type PageRotation = 0 | 90 | 180 | 270;

export interface PageLayout {
  /** Display order at read time. Not an identity; shifts on a page move. */
  index: number;
  /** Durable identity; the only safe key for cross-call correlation and the
   * key every leaf URL (`/pages/{pon}/...`) is addressed by. */
  pageObjectNumber: PageObjectNumber;
  /** `/PageLabels` entry, or `null` when the PDF declares no label (the SDK
   * falls back to `index + 1`). */
  label: string | null;
  /** Un-rotated crop width in PDF points. */
  width: number;
  /** Un-rotated crop height in PDF points. */
  height: number;
  rotation: PageRotation;
  /** `/UserUnit`; defaults to the PDF default of 1. */
  userUnit: number;
  boxes: PageBoxes;
}
