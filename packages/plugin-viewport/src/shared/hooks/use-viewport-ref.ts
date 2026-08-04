import { Rect } from '@embedpdf/models';
import { useLayoutEffect, useRef } from '@framework';
import { smoothScrollTo, SmoothScrollHandle } from '@embedpdf/plugin-viewport';
import { useViewportPlugin } from './use-viewport';

export function useViewportRef(documentId: string) {
  const { plugin: viewportPlugin } = useViewportPlugin();
  const containerRef = useRef<HTMLDivElement>(null);
  const activeAnimationRef = useRef<SmoothScrollHandle | null>(null);

  useLayoutEffect(() => {
    if (!viewportPlugin) return;

    const container = containerRef.current;
    if (!container) return;

    // Register this viewport for the document
    try {
      viewportPlugin.registerViewport(documentId);
    } catch (error) {
      console.error(`Failed to register viewport for document ${documentId}:`, error);
      return;
    }

    // On scroll
    const onScroll = () => {
      viewportPlugin.setViewportScrollMetrics(documentId, {
        scrollTop: container.scrollTop,
        scrollLeft: container.scrollLeft,
      });
    };
    container.addEventListener('scroll', onScroll);

    // On resize
    const resizeObserver = new ResizeObserver(() => {
      viewportPlugin.setViewportResizeMetrics(documentId, {
        width: container.offsetWidth,
        height: container.offsetHeight,
        clientWidth: container.clientWidth,
        clientHeight: container.clientHeight,
        scrollTop: container.scrollTop,
        scrollLeft: container.scrollLeft,
        scrollWidth: container.scrollWidth,
        scrollHeight: container.scrollHeight,
        clientLeft: container.clientLeft,
        clientTop: container.clientTop,
      });
    });
    resizeObserver.observe(container);

    // Cancel any in-flight smooth animation (superseded by a newer request).
    const cancelActiveAnimation = () => {
      activeAnimationRef.current?.cancel();
      activeAnimationRef.current = null;
    };

    // Subscribe to scroll requests for this document
    const unsubscribeScrollRequest = viewportPlugin.onScrollRequest(
      documentId,
      ({ x, y, behavior = 'auto' }) => {
        requestAnimationFrame(() => {
          cancelActiveAnimation();

          if (behavior === 'smooth') {
            // Custom eased animation: capped duration regardless of distance,
            // so long jumps feel as snappy as short ones.
            activeAnimationRef.current = smoothScrollTo(container, { left: x, top: y });
          } else {
            // 'instant' / 'auto' jump straight to the target.
            container.scrollTo({ left: x, top: y, behavior: 'auto' });
          }
        });
      },
    );

    // Cleanup
    return () => {
      cancelActiveAnimation();
      viewportPlugin.unregisterViewport(documentId);
      resizeObserver.disconnect();
      container.removeEventListener('scroll', onScroll);
      unsubscribeScrollRequest();
    };
  }, [viewportPlugin, documentId]);

  return containerRef;
}
