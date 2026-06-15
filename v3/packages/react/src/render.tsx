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
        // Render at the transform's exact device scale — width pinned, height the
        // engine's derived value — so the bitmap matches its box 1:1 (no blur), with
        // dpr already folded in. No `* dpr` guesswork in the adapter.
        const image = await render.renderPage(
          page.pon,
          page.transform.renderScale,
          controller.signal,
        );
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
  }, [render, page.pon, page.transform.renderScale]);
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
