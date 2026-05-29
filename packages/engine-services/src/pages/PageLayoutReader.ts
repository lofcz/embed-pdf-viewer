import type { PdfFunctions, PdfRuntimeMemory, PdfRuntimeModule, Ptr } from '@embedpdf/pdf-runtime';
import { NULL_PTR } from '@embedpdf/pdf-runtime';
import type {
  PageBoxes,
  PageLayout,
  PageListSnapshot,
  PageObjectNumber,
  PdfRect,
} from '@embedpdf/engine-core/runtime';
import type { DocumentSession } from '../session/DocumentSession';
import { throwIfAborted } from '../abort';

// EPDF_PAGE_BOX_TYPE (public/fpdfview.h).
const BOX_MEDIA = 0;
const BOX_CROP = 1;
const BOX_BLEED = 2;
const BOX_TRIM = 3;
const BOX_ART = 4;

// FS_RECTF is { float left; float top; float right; float bottom; } → 16 bytes.
const RECTF_BYTES = 16;
// FS_SIZEF is { float width; float height; } → 8 bytes.
const SIZEF_BYTES = 8;
const FLOAT_BYTES = 4;

/**
 * Runtime-agnostic page geometry reader. Produces the `pages.list()`
 * snapshot from the lightweight `...ByIndex` PDFium bindings, none of which
 * load or parse a page (no `pagePtr`), so listing stays cheap. Shared
 * verbatim by the local WASM worker and the server native worker, so a
 * given PDF yields an identical `PageListSnapshot` on both engines.
 */
export class PageLayoutReader {
  constructor(
    private readonly runtime: PdfRuntimeModule,
    private readonly session: DocumentSession,
  ) {}

  read(signal: AbortSignal): PageListSnapshot {
    throwIfAborted(signal);
    const { fn, mem } = this.runtime;
    const docPtr = this.session.requireDocPtr();
    const records = this.session.allRecords();

    const rectPtr = mem.alloc(RECTF_BYTES);
    const sizePtr = mem.alloc(SIZEF_BYTES);
    const userUnitPtr = mem.alloc(FLOAT_BYTES);
    try {
      const pages: PageLayout[] = records.map((record) => {
        throwIfAborted(signal);
        const index = record.pageIndex;
        return {
          index,
          pageObjectNumber: record.pageObjectNumber,
          label: readLabel(fn, mem, docPtr, index),
          ...readSize(fn, mem, docPtr, index, sizePtr),
          rotation: readRotation(fn, docPtr, index),
          userUnit: readUserUnit(fn, mem, docPtr, index, userUnitPtr),
          boxes: readBoxes(fn, mem, docPtr, index, rectPtr),
        };
      });
      return { pageCount: pages.length, pages };
    } finally {
      mem.free(userUnitPtr);
      mem.free(sizePtr);
      mem.free(rectPtr);
    }
  }
}

/**
 * Read one FS_RECTF box and canonicalize to `[llx, lly, urx, ury]` so the
 * lower-left/upper-right invariant holds regardless of how the PDF ordered
 * the corners. Returns null when the optional box is absent.
 */
function readBox(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  docPtr: Ptr,
  index: number,
  boxType: number,
  rectPtr: Ptr,
): PdfRect | null {
  if (!fn.EPDF_GetPageBoxByIndex(docPtr, index, boxType, rectPtr)) return null;
  const left = Number(mem.peek(rectPtr, 'f32', 0));
  const top = Number(mem.peek(rectPtr, 'f32', 4));
  const right = Number(mem.peek(rectPtr, 'f32', 8));
  const bottom = Number(mem.peek(rectPtr, 'f32', 12));
  return [
    Math.min(left, right),
    Math.min(top, bottom),
    Math.max(left, right),
    Math.max(top, bottom),
  ];
}

function readBoxes(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  docPtr: Ptr,
  index: number,
  rectPtr: Ptr,
): PageBoxes {
  // MediaBox always resolves (page-tree inheritance + PDFium default).
  // CropBox falls back to MediaBox, so both are guaranteed present.
  const media = readBox(fn, mem, docPtr, index, BOX_MEDIA, rectPtr) ?? [0, 0, 0, 0];
  const crop = readBox(fn, mem, docPtr, index, BOX_CROP, rectPtr) ?? media;
  const bleed = readBox(fn, mem, docPtr, index, BOX_BLEED, rectPtr);
  const trim = readBox(fn, mem, docPtr, index, BOX_TRIM, rectPtr);
  const art = readBox(fn, mem, docPtr, index, BOX_ART, rectPtr);
  return {
    media,
    crop,
    ...(bleed ? { bleed } : {}),
    ...(trim ? { trim } : {}),
    ...(art ? { art } : {}),
  };
}

function readSize(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  docPtr: Ptr,
  index: number,
  sizePtr: Ptr,
): { width: number; height: number } {
  if (!fn.EPDF_GetPageSizeByIndexNormalized(docPtr, index, sizePtr)) {
    return { width: 0, height: 0 };
  }
  return {
    width: Number(mem.peek(sizePtr, 'f32', 0)),
    height: Number(mem.peek(sizePtr, 'f32', 4)),
  };
}

function readRotation(fn: PdfFunctions, docPtr: Ptr, index: number): 0 | 90 | 180 | 270 {
  // Returns quarter-turns (0..3), or -1 on error.
  const quarterTurns = fn.EPDF_GetPageRotationByIndex(docPtr, index);
  switch (quarterTurns) {
    case 1:
      return 90;
    case 2:
      return 180;
    case 3:
      return 270;
    default:
      return 0;
  }
}

function readUserUnit(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  docPtr: Ptr,
  index: number,
  userUnitPtr: Ptr,
): number {
  if (!fn.EPDF_GetPageUserUnitByIndex(docPtr, index, userUnitPtr)) return 1;
  const value = Number(mem.peek(userUnitPtr, 'f32', 0));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function readLabel(
  fn: PdfFunctions,
  mem: PdfRuntimeMemory,
  docPtr: Ptr,
  index: number,
): string | null {
  // Two-call UTF-16 pattern (same as FPDF_GetMetaText): first discover the
  // byte length (NUL included), then read into a buffer.
  const len = fn.FPDF_GetPageLabel(docPtr, index, NULL_PTR, 0);
  if (len <= 2) return null; // 0 = absent; 2 = lone UTF-16 NUL (empty)
  const buf = mem.alloc(len);
  try {
    const written = fn.FPDF_GetPageLabel(docPtr, index, buf, len);
    if (written <= 0) return null;
    const label = mem.readU16String(buf);
    return label.length > 0 ? label : null;
  } finally {
    mem.free(buf);
  }
}
