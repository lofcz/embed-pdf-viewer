import { createCapabilityToken } from '@embedpdf-x/kernel';
import type { BinarySource, Engine } from '@embedpdf/engine-core/runtime';

/**
 * The stamp plugin: a workspace-scoped ASSET substrate.
 *
 * The design law ("documents have a home; assets ride the wire"): a stamp is
 * never a document. It is a small byte payload — a single-page PDF (vector)
 * or PNG/JPEG — that enters a document only as a stamp draft's `source`,
 * which both engines already carry out-of-band. The engine is touched in
 * exactly one place: importing a library PDF (open → per-page `extract` +
 * preview render → close), through the ASSET ENGINE port below. Placement
 * itself needs no engine here — it delegates to the annotation plugin's
 * armed-stamp flow on whichever document the caller names.
 */

export type StampAssetKind = 'stamp' | 'signature' | 'initials';

/**
 * One asset's SERIALIZABLE descriptor. The bytes and the cached preview are
 * deliberately NOT here — the reducer state stays pure/serializable (kernel
 * rule 1); binary lives in the capability and crosses only as call
 * arguments/returns, mirroring the engine's own BinarySource rule.
 */
export interface StampAsset {
  id: string;
  libraryId: string;
  kind: StampAssetKind;
  name: string;
  /** Intrinsic size in PDF points (the source page's crop box / image pixels 1:1). */
  size: { width: number; height: number };
  /** What the asset bytes are: a single-page vector PDF, or a raster image. */
  format: 'pdf' | 'png' | 'jpeg';
}

/** A named group of assets — one imported PDF becomes one library. */
export interface StampLibrary {
  id: string;
  name: string;
  /** Asset ids in display order. */
  assetIds: string[];
}

export interface StampState {
  libraries: Record<string, StampLibrary>;
  /** Library display order (insertion order). */
  libraryOrder: string[];
  assets: Record<string, StampAsset>;
}

export type StampAction =
  | { type: 'LIBRARY_ADDED'; library: StampLibrary }
  | { type: 'LIBRARY_REMOVED'; libraryId: string }
  | { type: 'ASSET_ADDED'; asset: StampAsset }
  | { type: 'ASSET_REMOVED'; assetId: string };

export interface StampConfig {
  /**
   * The ASSET ENGINE port: any `Engine` that can open `{ kind: 'bytes' }` —
   * used only to slice an imported library PDF into per-page assets and
   * render their previews.
   *
   * Omitted → the kernel's own engine is used, which is exactly right for a
   * local deployment (same WASM instance, zero extra cost). In a CLOUD
   * deployment the kernel engine cannot open local bytes, so pass a factory —
   * it is wrapped in `deferredEngine`, so the WASM loads on the first import,
   * never at viewer boot:
   *
   * ```ts
   * stampPlugin({
   *   assetEngine: () => import('@embedpdf/engine').then((m) => m.createLocalEngine()),
   * })
   * ```
   */
  assetEngine?: Engine | (() => Promise<Engine>);
  /** Cached preview width in device px (import-time render). Default 256. */
  previewWidth?: number;
}

export interface ImportLibraryOptions {
  /** Library display name. Default `'Stamps'`. */
  name?: string;
  /** Kind stamped onto every imported asset. Default `'stamp'`. */
  kind?: StampAssetKind;
  /** Per-page asset names; default `Stamp <n>`. */
  assetName?: (pageIndex: number) => string;
}

export interface AddAssetInput {
  /** Target library; omitted → a new single-asset library named after the asset. */
  libraryId?: string;
  name: string;
  kind?: StampAssetKind;
  /** Single-page PDF (vector) or PNG/JPEG bytes. */
  source: BinarySource;
  /**
   * Paintable preview for pickers + the hover ghost. Required for PDF
   * sources added directly (there is no open document to render them from);
   * raster sources default to their own bytes.
   */
  preview?: BinarySource;
  /** Intrinsic size in PDF points. Required for PDF sources; rasters are sniffed. */
  size?: { width: number; height: number };
}

/** A cached, browser-paintable render of an asset (PNG from import; raster assets as-is). */
export interface StampAssetPreview {
  bytes: Uint8Array;
  mimeType: string;
}

export interface StampCapability {
  // ── selectors (pure reads over serializable state) ──
  libraries(): StampLibrary[];
  library(id: string): StampLibrary | null;
  /** Assets of one library, in library order — or every asset when omitted. */
  assets(libraryId?: string): StampAsset[];
  asset(id: string): StampAsset | null;
  // ── binary reads (capability-held, never store state) ──
  /** The asset's paintable preview, or null while none is cached. */
  assetPreview(id: string): StampAssetPreview | null;
  /** The asset's durable content bytes (what placement embeds into the PDF). */
  assetBytes(id: string): Uint8Array | null;
  // ── library intents ──
  /**
   * Import a PDF as a stamp library: every page becomes one vector asset
   * (single-page PDF bytes + a cached preview render). Uses the asset
   * engine; in a cloud deployment without one configured this rejects with
   * an actionable error. Resolves to the new library id.
   */
  importLibraryPdf(source: BinarySource, opts?: ImportLibraryOptions): Promise<string>;
  /** Add a single asset from bytes (no engine needed for rasters/pre-sliced PDFs). */
  addAsset(input: AddAssetInput): Promise<string>;
  removeAsset(id: string): void;
  /** Remove a library and every asset in it. */
  removeLibrary(id: string): void;
  // ── placement (delegates to the annotation plugin of the named document) ──
  /**
   * Arm an asset on a document: the next click on that document's pages
   * places it (and the hover ghost previews the exact placement). Rides
   * `annotation.armStamp` — bytes, cached preview, and intrinsic size all
   * travel along, so vector stamps keep their true aspect.
   */
  armAsset(documentId: string, assetId: string, opts?: { targetWidth?: number }): Promise<void>;
  /** Disarm the stamp tool on a document. */
  disarm(documentId: string): void;
}

export const StampToken = createCapabilityToken<StampCapability>('stamp');
