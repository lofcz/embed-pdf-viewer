/**
 * RenderLayer — the React view of @embedpdf-x/plugin-render.
 *
 * Paints a page to an <img> from the engine's ENCODED image() (identical for local
 * & cloud). Abortable (cancels when the camera moves / the layer unmounts) and
 * leak-free (revokes the object URL).
 */
import * as React from 'react';
import { useEffect, useRef } from 'react';
import { RenderToken } from '@embedpdf-x/plugin-render';
import { useCapability, usePage } from './runtime';

export function RenderLayer() {
  const page = usePage();
  const render = useCapability(RenderToken);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let revoke: (() => void) | undefined;
    (async () => {
      try {
        const dpr = window.devicePixelRatio || 1;
        const image = await render.renderPage(page.pon, page.scale * dpr, controller.signal);
        const obj = await image.objectUrl(controller.signal);
        if (controller.signal.aborted) {
          obj.revoke();
          return;
        }
        revoke = obj.revoke;
        if (ref.current) ref.current.src = obj.url;
      } catch {
        /* aborted (camera moved / unmounted) or render failed */
      }
    })();
    return () => {
      controller.abort();
      revoke?.();
    };
  }, [render, page.pon, page.scale, page.size.width, page.size.height]);
  return (
    <img
      ref={ref}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}
