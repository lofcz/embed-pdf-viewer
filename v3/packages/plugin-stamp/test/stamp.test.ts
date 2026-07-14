import { describe, expect, it, vi } from 'vitest';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core/runtime';
import type { Engine } from '@embedpdf/engine-core/runtime';
import type { PluginContext } from '@embedpdf-x/kernel';
import { createStampCapability } from '../src/capability';
import { initialStampState, stampReducer } from '../src/reducer';
import type { StampAction, StampState } from '../src/types';

/** Minimal PDF bytes — enough for the magic-byte sniff. */
const pdfBytes = () => new TextEncoder().encode('%PDF-1.7\n%fake fixture\n');

/** Minimal PNG header: signature + IHDR with width=100, height=50. */
const pngBytes = () => {
  const b = new Uint8Array(32);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const dv = new DataView(b.buffer);
  dv.setUint32(8, 13); // IHDR length
  b.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
  dv.setUint32(16, 100); // width
  dv.setUint32(20, 50); // height
  return b;
};

/** A live store + PluginContext stub: dispatch runs the real reducer. */
function makeCtx(engine: Engine, annotation?: Record<string, unknown>) {
  let state: StampState = initialStampState();
  const ctx = {
    id: 'stamp',
    engine,
    doc: null,
    getState: () => state,
    dispatch: (action: StampAction) => {
      state = stampReducer(state, action);
    },
    subscribe: () => () => {},
    forDocument: <T>(_token: unknown, documentId: string): T => {
      if (!annotation) throw new Error(`no annotation for '${documentId}'`);
      return annotation as T;
    },
  } as unknown as PluginContext<StampState, StampAction>;
  return ctx;
}

/** An asset-engine stub: N pages, each extracting/rendering distinct bytes. */
function makeAssetEngine(pageCount: number) {
  const pages = Array.from({ length: pageCount }, (_, i) => ({
    pageObjectNumber: 100 + i,
    index: i,
    size: { width: 200 + i, height: 100 + i },
  }));
  const close = vi.fn(async () => {});
  const extract = vi.fn(async (pons: number[]) => new TextEncoder().encode(`%PDF-page-${pons[0]}`));
  const handle = {
    pages: { list: async () => ({ pageCount, pages }), extract },
    page: (pon: number) => ({
      render: {
        image: async () => ({
          contentType: 'image/png',
          source: { kind: 'bytes', bytes: new TextEncoder().encode(`png-${pon}`) },
        }),
      },
    }),
    close,
  };
  const engine = { open: vi.fn(async () => handle) } as unknown as Engine;
  return { engine, close, extract };
}

describe('stamp plugin — library import', () => {
  it('imports a PDF: one vector asset per page, previews cached, doc closed', async () => {
    const { engine, close, extract } = makeAssetEngine(2);
    const cap = createStampCapability(makeCtx(engine));

    const libraryId = await cap.importLibraryPdf(pdfBytes(), { name: 'Approvals' });

    const libs = cap.libraries();
    expect(libs).toHaveLength(1);
    expect(libs[0].name).toBe('Approvals');
    const assets = cap.assets(libraryId);
    expect(assets).toHaveLength(2);
    expect(assets[0]).toMatchObject({
      kind: 'stamp',
      name: 'Stamp 1',
      size: { width: 200, height: 100 },
      format: 'pdf',
    });
    // Per-asset binaries: the extracted single-page PDF + its preview render.
    expect(new TextDecoder().decode(cap.assetBytes(assets[0].id)!)).toBe('%PDF-page-100');
    expect(cap.assetPreview(assets[0].id)).toMatchObject({ mimeType: 'image/png' });
    expect(extract).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects non-PDF bytes with InvalidArg', async () => {
    const { engine } = makeAssetEngine(1);
    const cap = createStampCapability(makeCtx(engine));
    await expect(cap.importLibraryPdf(pngBytes())).rejects.toMatchObject({
      code: EngineErrorCode.InvalidArg,
    });
  });

  it('a cloud kernel engine with no configured assetEngine fails with the configuration fix', async () => {
    const cloudish = {
      open: () => {
        throw new EngineError(
          EngineErrorCode.InvalidArg,
          "cloud engine supports OpenInput kind 'token' or 'id'",
        );
      },
    } as unknown as Engine;
    const cap = createStampCapability(makeCtx(cloudish));
    await expect(cap.importLibraryPdf(pdfBytes())).rejects.toMatchObject({
      code: EngineErrorCode.NotImplemented,
      message: expect.stringContaining('assetEngine'),
    });
  });
});

describe('stamp plugin — assets', () => {
  it('addAsset sniffs raster size and uses the image itself as preview', async () => {
    const { engine } = makeAssetEngine(0);
    const cap = createStampCapability(makeCtx(engine));
    const id = await cap.addAsset({ name: 'Logo', source: pngBytes() });
    expect(cap.asset(id)).toMatchObject({
      format: 'png',
      size: { width: 100, height: 50 },
    });
    expect(cap.assetPreview(id)?.mimeType).toBe('image/png');
    // Single-asset convenience library named after the asset.
    expect(cap.libraries()[0].name).toBe('Logo');
  });

  it('a directly-added PDF asset requires an explicit size', async () => {
    const { engine } = makeAssetEngine(0);
    const cap = createStampCapability(makeCtx(engine));
    await expect(cap.addAsset({ name: 'Sig', source: pdfBytes() })).rejects.toMatchObject({
      code: EngineErrorCode.InvalidArg,
    });
    const id = await cap.addAsset({
      name: 'Sig',
      source: pdfBytes(),
      size: { width: 150, height: 60 },
    });
    expect(cap.asset(id)).toMatchObject({ format: 'pdf', size: { width: 150, height: 60 } });
    // No preview supplied and none derivable — pickers fall back, ghost stays off.
    expect(cap.assetPreview(id)).toBeNull();
  });

  it('removeLibrary drops the library, its assets, and their binaries', async () => {
    const { engine } = makeAssetEngine(2);
    const cap = createStampCapability(makeCtx(engine));
    const libraryId = await cap.importLibraryPdf(pdfBytes());
    const [a] = cap.assets(libraryId);
    cap.removeLibrary(libraryId);
    expect(cap.libraries()).toHaveLength(0);
    expect(cap.assets()).toHaveLength(0);
    expect(cap.assetBytes(a.id)).toBeNull();
  });
});

describe('stamp plugin — placement', () => {
  it('armAsset delegates to the document annotation plugin with bytes + preview + intrinsic size', async () => {
    const { engine } = makeAssetEngine(1);
    const armStamp = vi.fn(async () => {});
    const cap = createStampCapability(makeCtx(engine, { armStamp }));
    const libraryId = await cap.importLibraryPdf(pdfBytes());
    const [asset] = cap.assets(libraryId);

    await cap.armAsset('doc-1', asset.id, { targetWidth: 120 });

    expect(armStamp).toHaveBeenCalledTimes(1);
    const input = armStamp.mock.calls[0][0] as {
      source: Uint8Array;
      preview?: { data: Uint8Array; mimeType?: string };
      intrinsicSize?: { width: number; height: number };
      targetWidth?: number;
    };
    expect(new TextDecoder().decode(input.source)).toBe('%PDF-page-100');
    expect(input.preview?.mimeType).toBe('image/png');
    expect(input.intrinsicSize).toEqual({ width: 200, height: 100 });
    expect(input.targetWidth).toBe(120);
  });

  it('arming an unknown asset rejects with NotFound', async () => {
    const { engine } = makeAssetEngine(0);
    const cap = createStampCapability(makeCtx(engine, { armStamp: vi.fn() }));
    await expect(cap.armAsset('doc-1', 'nope')).rejects.toMatchObject({
      code: EngineErrorCode.NotFound,
    });
  });
});
