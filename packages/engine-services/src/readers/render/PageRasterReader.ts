import type { PdfRuntimeModule, Ptr } from '@embedpdf/pdf-runtime';
import type {
  PageObjectNumber,
  PageRaster,
  PageRenderOptions,
  PageRenderTarget,
  Rect,
  Rotation,
} from '@embedpdf/engine-core/runtime';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core/runtime';
import type { DocumentSession } from '../../session/DocumentSession';
import { throwIfAborted } from '../../abort';

const FPDF_BITMAP_BGRA = 4;
const FPDF_RENDER_ANNOT = 0x01;
const FPDF_REVERSE_BYTE_ORDER = 0x10;

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export class PageRasterReader {
  constructor(
    private readonly runtime: PdfRuntimeModule,
    private readonly session: DocumentSession,
  ) {}

  render(pageObjectNumber: PageObjectNumber, options: PageRenderOptions, signal: AbortSignal) {
    throwIfAborted(signal);
    const { fn, mem } = this.runtime;
    const pool = this.session.pagePool();
    const pagePtr = pool.acquire(pageObjectNumber);

    let bitmapPtr: Ptr | null = null;
    let pixelPtr: Ptr | null = null;
    let matrixPtr: Ptr | null = null;
    let clipPtr: Ptr | null = null;

    try {
      throwIfAborted(signal);

      const target = resolveTarget(
        options.target,
        fn.FPDF_GetPageWidthF(pagePtr),
        fn.FPDF_GetPageHeightF(pagePtr),
      );
      const rotation = options.rotation ?? 0;
      const { width, height } = resolveDeviceSize(target, rotation, options);
      const stride = width * 4;
      const bytes = stride * height;

      pixelPtr = mem.alloc(bytes);
      bitmapPtr = fn.FPDFBitmap_CreateEx(width, height, FPDF_BITMAP_BGRA, pixelPtr, stride);
      if (!bitmapPtr) {
        throw new EngineError(
          EngineErrorCode.RuntimeUnavailable,
          `FPDFBitmap_CreateEx returned null for page object ${pageObjectNumber}`,
        );
      }

      fn.FPDFBitmap_FillRect(
        bitmapPtr,
        0,
        0,
        width,
        height,
        options.background === 'transparent' ? 0x00000000 : 0xffffffff,
      );

      const matrix = buildUserToDeviceMatrix(target, rotation, width, height);
      matrixPtr = mem.alloc(6 * 4);
      writeMatrix(mem, matrixPtr, matrix);

      clipPtr = mem.alloc(4 * 4);
      mem.poke(clipPtr, 'f32', 0, 0);
      mem.poke(clipPtr, 'f32', 0, 4);
      mem.poke(clipPtr, 'f32', width, 8);
      mem.poke(clipPtr, 'f32', height, 12);

      let flags = FPDF_REVERSE_BYTE_ORDER;
      if (options.includeAnnotations ?? true) {
        flags |= FPDF_RENDER_ANNOT;
      }

      throwIfAborted(signal);
      fn.FPDF_RenderPageBitmapWithMatrix(bitmapPtr, pagePtr, matrixPtr, clipPtr, flags);
      throwIfAborted(signal);

      const pixels = mem.readBytes(pixelPtr, bytes);
      const raster: PageRaster = {
        width,
        height,
        stride,
        color: 'rgba8',
        premultipliedAlpha: false,
        data: toExactArrayBuffer(pixels),
      };
      return raster;
    } finally {
      if (bitmapPtr) fn.FPDFBitmap_Destroy(bitmapPtr);
      if (clipPtr) mem.free(clipPtr);
      if (matrixPtr) mem.free(matrixPtr);
      if (pixelPtr) mem.free(pixelPtr);
      pool.release(pageObjectNumber);
    }
  }
}

function resolveTarget(
  target: PageRenderTarget | undefined,
  pageWidth: number,
  pageHeight: number,
) {
  if (!target || target.kind === 'page') {
    return { left: 0, bottom: 0, right: pageWidth, top: pageHeight };
  }
  const rect = normalizeRect(target.rect);
  if (rect.right <= rect.left || rect.top <= rect.bottom) {
    throw new EngineError(EngineErrorCode.InvalidArg, 'render rect must have positive area');
  }
  return rect;
}

function normalizeRect(rect: Rect): Rect {
  return {
    left: Math.min(rect.left, rect.right),
    right: Math.max(rect.left, rect.right),
    top: Math.max(rect.top, rect.bottom),
    bottom: Math.min(rect.top, rect.bottom),
  };
}

function resolveDeviceSize(
  rect: Rect,
  rotation: Rotation,
  options: PageRenderOptions,
): { width: number; height: number } {
  const rectWidth = rect.right - rect.left;
  const rectHeight = rect.top - rect.bottom;
  const swap = rotation === 90 || rotation === 270;
  const baseWidth = swap ? rectHeight : rectWidth;
  const baseHeight = swap ? rectWidth : rectHeight;
  const viewport = options.viewport ?? { kind: 'scale', scale: 1 };

  if (viewport.kind === 'width') {
    if (!Number.isFinite(viewport.width) || viewport.width <= 0) {
      throw new EngineError(EngineErrorCode.InvalidArg, 'render viewport width must be positive');
    }
    const width = Math.max(1, Math.round(viewport.width));
    return { width, height: Math.max(1, Math.round((width * baseHeight) / baseWidth)) };
  }

  const scale = viewport.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new EngineError(EngineErrorCode.InvalidArg, 'render viewport scale must be positive');
  }
  return {
    width: Math.max(1, Math.round(baseWidth * scale)),
    height: Math.max(1, Math.round(baseHeight * scale)),
  };
}

function buildUserToDeviceMatrix(
  rect: Rect,
  rotation: Rotation,
  outW: number,
  outH: number,
): Matrix {
  const left = rect.left;
  const bottom = rect.bottom;
  const width = rect.right - rect.left;
  const height = rect.top - rect.bottom;
  const sx0 = outW / width;
  const sy0 = outH / height;
  const sx90 = outW / height;
  const sy90 = outH / width;

  switch (rotation) {
    case 0:
      return { a: sx0, b: 0, c: 0, d: sy0, e: -sx0 * left, f: -sy0 * bottom };
    case 90:
      return { a: 0, b: sy90, c: -sx90, d: 0, e: sx90 * (bottom + height), f: -sy90 * left };
    case 180:
      return {
        a: -sx0,
        b: 0,
        c: 0,
        d: -sy0,
        e: sx0 * (left + width),
        f: sy0 * (bottom + height),
      };
    case 270:
      return { a: 0, b: -sy90, c: sx90, d: 0, e: -sx90 * bottom, f: sy90 * (left + width) };
    default:
      throw new EngineError(EngineErrorCode.InvalidArg, `unsupported render rotation: ${rotation}`);
  }
}

function writeMatrix(mem: PdfRuntimeModule['mem'], ptr: Ptr, matrix: Matrix) {
  mem.poke(ptr, 'f32', matrix.a, 0);
  mem.poke(ptr, 'f32', matrix.b, 4);
  mem.poke(ptr, 'f32', matrix.c, 8);
  mem.poke(ptr, 'f32', matrix.d, 12);
  mem.poke(ptr, 'f32', matrix.e, 16);
  mem.poke(ptr, 'f32', matrix.f, 20);
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}
