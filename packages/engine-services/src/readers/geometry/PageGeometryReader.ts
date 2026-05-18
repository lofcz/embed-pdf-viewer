import type { PdfRuntimeModule, Ptr } from '@embedpdf/pdf-runtime';
import type {
  PageGeometryGlyph,
  PageGeometryRun,
  PageGeometrySnapshot,
  PageObjectNumber,
} from '@embedpdf/engine-core/runtime';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core/runtime';
import type { DocumentSession } from '../../session/DocumentSession';
import { throwIfAborted } from '../../abort';

interface GlyphInfo {
  origin: { x: number; y: number };
  size: { width: number; height: number };
  tightOrigin?: { x: number; y: number };
  tightSize?: { width: number; height: number };
  isSpace?: boolean;
  isEmpty?: boolean;
}

/**
 * Geometry-only text layout reader. This ports the old engine's
 * `getPageGeometry()` shape into the v3 worker/session model.
 */
export class PageGeometryReader {
  constructor(
    private readonly runtime: PdfRuntimeModule,
    private readonly session: DocumentSession,
  ) {}

  read(pageObjectNumber: PageObjectNumber, signal: AbortSignal): PageGeometrySnapshot {
    throwIfAborted(signal);
    const { fn } = this.runtime;
    const pool = this.session.pagePool();
    const pagePtr = pool.acquire(pageObjectNumber);

    try {
      throwIfAborted(signal);
      const textPagePtr = fn.FPDFText_LoadPage(pagePtr);
      if (!textPagePtr) {
        throw new EngineError(
          EngineErrorCode.RuntimeUnavailable,
          `FPDFText_LoadPage returned null for page object ${pageObjectNumber}`,
        );
      }
      try {
        throwIfAborted(signal);
        const glyphCount = Math.max(fn.FPDFText_CountChars(textPagePtr), 0);
        const pageWidth = Math.ceil(fn.FPDF_GetPageWidthF(pagePtr));
        const pageHeight = Math.ceil(fn.FPDF_GetPageHeightF(pagePtr));
        const glyphs: GlyphInfo[] = [];

        for (let i = 0; i < glyphCount; i++) {
          throwIfAborted(signal);
          glyphs.push(this.readGlyphInfo(pagePtr, textPagePtr, i, pageWidth, pageHeight));
        }

        return {
          pageState: this.session.pageState(pageObjectNumber),
          runs: this.buildRunsFromGlyphs(glyphs, textPagePtr),
        };
      } finally {
        fn.FPDFText_ClosePage(textPagePtr);
      }
    } finally {
      pool.release(pageObjectNumber);
    }
  }

  private buildRunsFromGlyphs(glyphs: GlyphInfo[], textPagePtr: Ptr): PageGeometryRun[] {
    const { fn } = this.runtime;
    const runs: PageGeometryRun[] = [];
    let current: PageGeometryRun | null = null;
    let curObjPtr: Ptr | null = null;
    let bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

    for (let i = 0; i < glyphs.length; i++) {
      const glyph = glyphs[i];
      const objPtr = fn.FPDFText_GetTextObject(textPagePtr, i);

      if (objPtr !== curObjPtr) {
        curObjPtr = objPtr;
        current = {
          rect: {
            x: glyph.origin.x,
            y: glyph.origin.y,
            width: glyph.size.width,
            height: glyph.size.height,
          },
          charStart: i,
          glyphs: [],
          fontSize: fn.FPDFText_GetFontSize(textPagePtr, i),
        };
        bounds = {
          minX: glyph.origin.x,
          minY: glyph.origin.y,
          maxX: glyph.origin.x + glyph.size.width,
          maxY: glyph.origin.y + glyph.size.height,
        };
        runs.push(current);
      }

      current!.glyphs.push(toSlimGlyph(glyph));

      if (glyph.isEmpty) {
        continue;
      }

      const right = glyph.origin.x + glyph.size.width;
      const bottom = glyph.origin.y + glyph.size.height;
      bounds!.minX = Math.min(bounds!.minX, glyph.origin.x);
      bounds!.minY = Math.min(bounds!.minY, glyph.origin.y);
      bounds!.maxX = Math.max(bounds!.maxX, right);
      bounds!.maxY = Math.max(bounds!.maxY, bottom);

      current!.rect.x = bounds!.minX;
      current!.rect.y = bounds!.minY;
      current!.rect.width = bounds!.maxX - bounds!.minX;
      current!.rect.height = bounds!.maxY - bounds!.minY;
    }

    return runs;
  }

  private readGlyphInfo(
    pagePtr: Ptr,
    textPagePtr: Ptr,
    charIndex: number,
    pageWidth: number,
    pageHeight: number,
  ): GlyphInfo {
    const { fn, mem } = this.runtime;
    const dx1Ptr = mem.alloc(4);
    const dy1Ptr = mem.alloc(4);
    const dx2Ptr = mem.alloc(4);
    const dy2Ptr = mem.alloc(4);
    const rectPtr = mem.alloc(16);
    const tLeftPtr = mem.alloc(8);
    const tRightPtr = mem.alloc(8);
    const tBottomPtr = mem.alloc(8);
    const tTopPtr = mem.alloc(8);
    const ptrs = [
      dx1Ptr,
      dy1Ptr,
      dx2Ptr,
      dy2Ptr,
      rectPtr,
      tLeftPtr,
      tRightPtr,
      tBottomPtr,
      tTopPtr,
    ];

    try {
      if (!fn.FPDFText_GetLooseCharBox(textPagePtr, charIndex, rectPtr)) {
        return emptyGlyph();
      }

      const left = Number(mem.peek(rectPtr, 'f32', 0));
      const top = Number(mem.peek(rectPtr, 'f32', 4));
      const right = Number(mem.peek(rectPtr, 'f32', 8));
      const bottom = Number(mem.peek(rectPtr, 'f32', 12));
      if (left === right || top === bottom) {
        return emptyGlyph();
      }

      fn.FPDF_PageToDevice(pagePtr, 0, 0, pageWidth, pageHeight, 0, left, top, dx1Ptr, dy1Ptr);
      fn.FPDF_PageToDevice(pagePtr, 0, 0, pageWidth, pageHeight, 0, right, bottom, dx2Ptr, dy2Ptr);

      const x1 = Number(mem.peek(dx1Ptr, 'i32'));
      const y1 = Number(mem.peek(dy1Ptr, 'i32'));
      const x2 = Number(mem.peek(dx2Ptr, 'i32'));
      const y2 = Number(mem.peek(dy2Ptr, 'i32'));
      const glyph: GlyphInfo = {
        origin: { x: Math.min(x1, x2), y: Math.min(y1, y2) },
        size: {
          width: Math.max(1, Math.abs(x2 - x1)),
          height: Math.max(1, Math.abs(y2 - y1)),
        },
      };

      if (
        fn.FPDFText_GetCharBox(textPagePtr, charIndex, tLeftPtr, tRightPtr, tBottomPtr, tTopPtr)
      ) {
        const tLeft = Number(mem.peek(tLeftPtr, 'f64'));
        const tRight = Number(mem.peek(tRightPtr, 'f64'));
        const tBottom = Number(mem.peek(tBottomPtr, 'f64'));
        const tTop = Number(mem.peek(tTopPtr, 'f64'));

        fn.FPDF_PageToDevice(pagePtr, 0, 0, pageWidth, pageHeight, 0, tLeft, tTop, dx1Ptr, dy1Ptr);
        fn.FPDF_PageToDevice(
          pagePtr,
          0,
          0,
          pageWidth,
          pageHeight,
          0,
          tRight,
          tBottom,
          dx2Ptr,
          dy2Ptr,
        );

        const tx1 = Number(mem.peek(dx1Ptr, 'i32'));
        const ty1 = Number(mem.peek(dy1Ptr, 'i32'));
        const tx2 = Number(mem.peek(dx2Ptr, 'i32'));
        const ty2 = Number(mem.peek(dy2Ptr, 'i32'));
        glyph.tightOrigin = { x: Math.min(tx1, tx2), y: Math.min(ty1, ty2) };
        glyph.tightSize = {
          width: Math.max(1, Math.abs(tx2 - tx1)),
          height: Math.max(1, Math.abs(ty2 - ty1)),
        };
      }

      glyph.isSpace = fn.FPDFText_GetUnicode(textPagePtr, charIndex) === 32;
      return glyph;
    } finally {
      for (const ptr of ptrs) mem.free(ptr);
    }
  }
}

function emptyGlyph(): GlyphInfo {
  return {
    origin: { x: 0, y: 0 },
    size: { width: 0, height: 0 },
    isEmpty: true,
  };
}

function toSlimGlyph(glyph: GlyphInfo): PageGeometryGlyph {
  return {
    x: glyph.origin.x,
    y: glyph.origin.y,
    width: glyph.size.width,
    height: glyph.size.height,
    flags: glyph.isEmpty ? 2 : glyph.isSpace ? 1 : 0,
    ...(glyph.tightOrigin && { tightX: glyph.tightOrigin.x, tightY: glyph.tightOrigin.y }),
    ...(glyph.tightSize && {
      tightWidth: glyph.tightSize.width,
      tightHeight: glyph.tightSize.height,
    }),
  };
}
