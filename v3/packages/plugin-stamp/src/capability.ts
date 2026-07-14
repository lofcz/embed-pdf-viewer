import { deferredEngine, type PluginContext } from '@embedpdf-x/kernel';
import {
  EngineError,
  EngineErrorCode,
  resolveBinarySource,
  sniffBinaryMetadata,
  type BinarySource,
  type DocumentHandle,
  type Engine,
  type PageImageHandle,
} from '@embedpdf/engine-core/runtime';
import { AnnotationToken } from '@embedpdf-x/plugin-annotation';
import type {
  AddAssetInput,
  ImportLibraryOptions,
  StampAction,
  StampAsset,
  StampAssetPreview,
  StampCapability,
  StampConfig,
  StampState,
} from './types';

const DEFAULT_PREVIEW_WIDTH = 256;

/** Session-unique ids. Assets are session-scoped for now (no persistence),
 *  so a timestamp + counter is enough — durable ids come with the store port. */
let seq = 0;
const uid = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function createStampCapability(
  ctx: PluginContext<StampState, StampAction>,
  config: StampConfig = {},
): StampCapability {
  /** Binary sidecar of the serializable store: asset bytes + cached preview,
   *  keyed by asset id. The reducer never sees these (kernel rule 1). */
  const binaries = new Map<string, { bytes: Uint8Array; preview: StampAssetPreview | null }>();

  // The ASSET ENGINE port. A configured factory is wrapped in deferredEngine
  // (boot on first import, not at viewer start); a configured instance is used
  // as-is; nothing configured falls back to the kernel's engine — correct for
  // local deployments, and rejected with an actionable error by cloud engines
  // at the first `open({ kind: 'bytes' })`.
  let assetEngineRef: Engine | null = null;
  const assetEngine = (): Engine => {
    if (!assetEngineRef) {
      const cfg = config.assetEngine;
      assetEngineRef = !cfg ? ctx.engine : typeof cfg === 'function' ? deferredEngine(cfg) : cfg;
    }
    return assetEngineRef;
  };

  const openAssetDocument = async (bytes: Uint8Array): Promise<DocumentHandle> => {
    try {
      return await assetEngine().open({ kind: 'bytes', id: uid('stamp-import'), bytes });
    } catch (err) {
      // A cloud kernel engine rejects 'bytes' with InvalidArg — turn the
      // generic contract error into the configuration fix.
      if (!config.assetEngine && EngineError.is(err, EngineErrorCode.InvalidArg)) {
        throw new EngineError(
          EngineErrorCode.NotImplemented,
          "[stamp] importing a library PDF needs an engine that can open local bytes, and this viewer's engine cannot (cloud). Pass stampPlugin({ assetEngine: () => import('@embedpdf/engine').then((m) => m.createLocalEngine()) }) — it loads lazily, on first import.",
        );
      }
      throw err;
    }
  };

  /** Import-time preview render → bytes. The asset engine is local by
   *  definition, so the image source is always inline bytes. */
  const imageToPreview = (image: PageImageHandle): StampAssetPreview => {
    if (image.source.kind !== 'bytes') {
      throw new EngineError(
        EngineErrorCode.NotImplemented,
        '[stamp] asset engine returned a URL-sourced render; asset engines must be local',
      );
    }
    return { bytes: image.source.bytes, mimeType: image.contentType };
  };

  const createLibrary = (name: string): string => {
    const id = uid('stamp-lib');
    ctx.dispatch({ type: 'LIBRARY_ADDED', library: { id, name, assetIds: [] } });
    return id;
  };

  const importLibraryPdf = async (
    source: BinarySource,
    opts?: ImportLibraryOptions,
  ): Promise<string> => {
    const resolved = await resolveBinarySource(source);
    const meta = sniffBinaryMetadata(resolved.bytes);
    if (meta?.mimeType !== 'application/pdf') {
      throw new EngineError(
        EngineErrorCode.InvalidArg,
        '[stamp] importLibraryPdf needs PDF bytes (use addAsset for a raster image)',
      );
    }
    const doc = await openAssetDocument(new Uint8Array(resolved.bytes));
    try {
      if (!doc.pages.extract) {
        throw new EngineError(
          EngineErrorCode.NotImplemented,
          '[stamp] the asset engine does not support pages.extract',
        );
      }
      const snapshot = await doc.pages.list();
      const libraryId = createLibrary(opts?.name ?? 'Stamps');
      for (const page of snapshot.pages) {
        // One page → one asset: the page as a standalone vector PDF, plus a
        // transparent preview render cached for pickers and the hover ghost.
        const bytes = await doc.pages.extract([page.pageObjectNumber]);
        const image = await doc.page(page.pageObjectNumber).render.image({
          viewport: { kind: 'width', width: config.previewWidth ?? DEFAULT_PREVIEW_WIDTH },
          background: 'transparent',
          includeAnnotations: true,
          format: 'png',
        });
        const asset: StampAsset = {
          id: uid('stamp'),
          libraryId,
          kind: opts?.kind ?? 'stamp',
          name: opts?.assetName?.(page.index) ?? `Stamp ${page.index + 1}`,
          size: { width: page.size.width, height: page.size.height },
          format: 'pdf',
        };
        binaries.set(asset.id, { bytes, preview: imageToPreview(image) });
        ctx.dispatch({ type: 'ASSET_ADDED', asset });
      }
      return libraryId;
    } finally {
      await doc.close();
    }
  };

  const addAsset = async (input: AddAssetInput): Promise<string> => {
    const resolved = await resolveBinarySource(input.source);
    const meta = sniffBinaryMetadata(resolved.bytes);
    if (!meta) {
      throw new EngineError(
        EngineErrorCode.InvalidArg,
        '[stamp] asset source must be PNG, JPEG, or single-page PDF bytes',
      );
    }
    const isPdf = meta.mimeType === 'application/pdf';
    const size =
      input.size ?? ('width' in meta ? { width: meta.width, height: meta.height } : null);
    if (!size) {
      throw new EngineError(
        EngineErrorCode.InvalidArg,
        '[stamp] a PDF asset needs `size` (its page size in points) — PDF bytes carry no sniffable dimensions',
      );
    }
    let preview: StampAssetPreview | null = null;
    if (input.preview) {
      const p = await resolveBinarySource(input.preview);
      preview = { bytes: new Uint8Array(p.bytes), mimeType: p.mimeType ?? 'image/png' };
    } else if (!isPdf) {
      preview = { bytes: new Uint8Array(resolved.bytes), mimeType: meta.mimeType };
    }
    const libraryId = input.libraryId ?? createLibrary(input.name);
    if (!ctx.getState().libraries[libraryId]) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `[stamp] unknown library '${input.libraryId}'`,
      );
    }
    const asset: StampAsset = {
      id: uid('stamp'),
      libraryId,
      kind: input.kind ?? 'stamp',
      name: input.name,
      size,
      format: isPdf ? 'pdf' : meta.mimeType === 'image/png' ? 'png' : 'jpeg',
    };
    binaries.set(asset.id, { bytes: new Uint8Array(resolved.bytes), preview });
    ctx.dispatch({ type: 'ASSET_ADDED', asset });
    return asset.id;
  };

  const removeAsset = (id: string): void => {
    binaries.delete(id);
    ctx.dispatch({ type: 'ASSET_REMOVED', assetId: id });
  };

  const removeLibrary = (id: string): void => {
    const library = ctx.getState().libraries[id];
    if (library) for (const assetId of library.assetIds) binaries.delete(assetId);
    ctx.dispatch({ type: 'LIBRARY_REMOVED', libraryId: id });
  };

  const armAsset = async (
    documentId: string,
    assetId: string,
    opts?: { targetWidth?: number },
  ): Promise<void> => {
    const asset = ctx.getState().assets[assetId];
    const bin = binaries.get(assetId);
    if (!asset || !bin) {
      throw new EngineError(EngineErrorCode.NotFound, `[stamp] unknown asset '${assetId}'`);
    }
    // The whole placement story is one armStamp call: content bytes ride as
    // the draft source, the cached preview becomes the hover ghost, and the
    // intrinsic size keeps a vector stamp's true aspect.
    const annotation = ctx.forDocument(AnnotationToken, documentId);
    await annotation.armStamp({
      source: bin.bytes,
      preview: bin.preview
        ? { data: bin.preview.bytes, mimeType: bin.preview.mimeType }
        : undefined,
      intrinsicSize: asset.size,
      targetWidth: opts?.targetWidth,
    });
  };

  return {
    libraries: () => {
      const s = ctx.getState();
      return s.libraryOrder.map((id) => s.libraries[id]).filter((l) => l != null);
    },
    library: (id) => ctx.getState().libraries[id] ?? null,
    assets: (libraryId) => {
      const s = ctx.getState();
      if (libraryId) {
        const library = s.libraries[libraryId];
        return library ? library.assetIds.map((id) => s.assets[id]).filter((a) => a != null) : [];
      }
      return s.libraryOrder.flatMap((lid) =>
        (s.libraries[lid]?.assetIds ?? []).map((id) => s.assets[id]).filter((a) => a != null),
      );
    },
    asset: (id) => ctx.getState().assets[id] ?? null,
    assetPreview: (id) => binaries.get(id)?.preview ?? null,
    assetBytes: (id) => binaries.get(id)?.bytes ?? null,
    importLibraryPdf,
    addAsset,
    removeAsset,
    removeLibrary,
    armAsset,
    disarm: (documentId) => ctx.forDocument(AnnotationToken, documentId).disarmStamp(),
  };
}
