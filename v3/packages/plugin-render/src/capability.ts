import type { PluginContext } from '@embedpdf-x/kernel';
import type { RenderCapability } from './types';

/**
 * Render a page through the document's engine handle, addressed by its durable pon.
 * The engine returns an AbortablePromise, which we wire to the caller's signal.
 */
export function createRenderCapability(ctx: PluginContext<unknown>): RenderCapability {
  return {
    renderPage(pon, scale, signal) {
      const doc = ctx.doc;
      if (!doc) return Promise.reject(new Error('render: no document bound'));
      const task = doc.page(pon).render.image({ viewport: { kind: 'scale', scale } });
      if (signal) {
        if (signal.aborted) task.abort(signal.reason);
        else signal.addEventListener('abort', () => task.abort(signal.reason), { once: true });
      }
      return task; // AbortablePromise<PageImageHandle> is a Promise<PageImageHandle>
    },
  };
}
