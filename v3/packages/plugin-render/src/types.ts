import {
  createCapabilityToken,
  type PageImageHandle,
  type PageObjectNumber,
} from '@embedpdf-x/kernel';

export interface RenderCapability {
  /**
   * Render a page (by its durable pon) to an ENCODED image at `scale` device px per
   * PDF point. Abortable. Encoded output is identical for local & cloud and cheap
   * over the wire (vs. raw RGBA).
   */
  renderPage(pon: PageObjectNumber, scale: number, signal?: AbortSignal): Promise<PageImageHandle>;
}

export const RenderToken = createCapabilityToken<RenderCapability>('render');
