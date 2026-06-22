import {
  createCapabilityToken,
  type PageImageHandle,
  type PageObjectNumber,
} from '@embedpdf-x/kernel';

export interface RenderPageOptions {
  /** Device px per PDF point (use the page transform's `renderScale`). */
  scale: number;
  /**
   * Bake annotations into the page bitmap. Default true. Pass false when an
   * <AnnotationLayer> owns annotation rendering, so they aren't painted twice
   * (once baked, once by the overlay).
   */
  includeAnnotations?: boolean;
  /** Abort the render (camera moved / layer unmounted). */
  signal?: AbortSignal;
}

export interface RenderCapability {
  /**
   * Render a page (by its durable pon) to an ENCODED image. Abortable. Encoded
   * output is identical for local & cloud and cheap over the wire (vs. raw RGBA).
   */
  renderPage(pon: PageObjectNumber, options: RenderPageOptions): Promise<PageImageHandle>;
}

export const RenderToken = createCapabilityToken<RenderCapability>('render');
