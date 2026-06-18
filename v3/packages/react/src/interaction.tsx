/**
 * The React surface for @embedpdf-x/plugin-interaction.
 *
 * <PagePointerSource> is the ONE pointer listener per page: it converts events to
 * page space via PageContext.toPagePoint and forwards normalized samples to the
 * hub. It binds only to the page context, so it works identically inside a
 * virtualized <Stage> page and a standalone <PageView>. Features never attach
 * their own pointer listeners — they register handlers with the hub.
 */
import * as React from 'react';
import { useEffect, useRef } from 'react';
import { InteractionToken } from '@embedpdf-x/plugin-interaction';
import type { Modifiers, PointerSample } from '@embedpdf-x/plugin-interaction';
import { useCapability, usePage, useSelector } from './runtime';

const mods = (e: PointerEvent): Modifiers => ({
  shift: e.shiftKey,
  alt: e.altKey,
  ctrl: e.ctrlKey,
  meta: e.metaKey,
});

/**
 * Robust multi-click counter. `pointerdown.detail` is 0/1 in several browsers, so
 * we count clicks ourselves from timing + proximity — the standard double/triple
 * detection. Input normalization belongs in the adapter; the hub/handlers stay pure.
 */
export function createClickCounter(maxGapMs = 400, maxDistPx = 6) {
  let last = 0;
  let lx = 0;
  let ly = 0;
  let count = 0;
  return (now: number, x: number, y: number): number => {
    count = now - last <= maxGapMs && Math.hypot(x - lx, y - ly) <= maxDistPx ? count + 1 : 1;
    last = now;
    lx = x;
    ly = y;
    return count;
  };
}

export function PagePointerSource() {
  const page = usePage();
  const interaction = useCapability(InteractionToken);
  const cursor = useSelector(InteractionToken, (c) => c.cursor());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const clicks = createClickCounter();
    const sample = (
      phase: PointerSample['phase'],
      e: PointerEvent,
      clickCount = 1,
    ): PointerSample => {
      const r = el.getBoundingClientRect();
      return {
        phase,
        viewport: { x: e.clientX - r.left, y: e.clientY - r.top },
        page: { pon: page.pon, point: page.toPagePoint(e.clientX, e.clientY) },
        modifiers: mods(e),
        clickCount,
      };
    };
    let dragging = false;

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      interaction.dispatch(sample('down', e, clicks(Date.now(), e.clientX, e.clientY)));
    };
    // hover (no gesture): drive cursor feedback only — fires from the element
    const hover = (e: PointerEvent) => {
      if (dragging) return;
      interaction.dispatch(sample('move', e));
    };
    // active drag: track on window so it survives leaving the page bounds
    const drag = (e: PointerEvent) => {
      if (!dragging) return;
      interaction.dispatch(sample('move', e));
    };
    const up = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      interaction.dispatch(sample('up', e));
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', hover);
    window.addEventListener('pointermove', drag);
    window.addEventListener('pointerup', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', hover);
      window.removeEventListener('pointermove', drag);
      window.removeEventListener('pointerup', up);
    };
  }, [interaction, page]);

  // Sits on top as the page's event surface; visual layers below use pointerEvents:none.
  return <div ref={ref} style={{ position: 'absolute', inset: 0, cursor, touchAction: 'none' }} />;
}

/** Read + switch the active tool (for a toolbar). */
export function useTool() {
  const interaction = useCapability(InteractionToken);
  const activeToolId = useSelector(InteractionToken, (c) => c.activeToolId());
  return {
    activeToolId,
    activate: interaction.activateTool,
    tools: interaction.tools(),
  };
}
