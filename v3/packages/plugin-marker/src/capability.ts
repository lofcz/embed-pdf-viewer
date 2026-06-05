import type { PluginContext } from '@embedpdf/kernel';
import type { MarkerAction, MarkerCapability, MarkerState } from './types';

const EMPTY: never[] = [];

export function createMarkerCapability(
  ctx: PluginContext<MarkerState, MarkerAction>,
): MarkerCapability {
  return {
    forPage: (i) => ctx.getState().byPage[i] ?? EMPTY,
    selectedId: () => ctx.getState().selected,
    selectedMarker: () => {
      const s = ctx.getState();
      if (!s.selected) return null;
      for (const k of Object.keys(s.byPage)) {
        const m = s.byPage[+k].find((x) => x.id === s.selected);
        if (m) return m;
      }
      return null;
    },
    add: (page, pt) => {
      const id = `m${ctx.getState().seq + 1}`;
      ctx.dispatch({ type: 'ADD', marker: { id, page, x: pt.x, y: pt.y } });
    },
    select: (id) => ctx.dispatch({ type: 'SELECT', id }),
    remove: (id) => ctx.dispatch({ type: 'REMOVE', id }),
  };
}
