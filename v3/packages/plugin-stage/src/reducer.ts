import { FRAMINGS } from './framing';
import type { StageAction, StageConfig, StageState } from './types';

export const initialStageState = (config: StageConfig): StageState => {
  const framing = config.framing ?? 'document';
  return {
    camera: { x: 0, y: 0, zoom: 1 },
    vp: { width: 0, height: 0 },
    layout: config.layout ?? 'vertical',
    spread: 'none',
    framing,
    zoomSpec: FRAMINGS[framing].zoom,
  };
};

/** Pure. Every transition is here; nothing else mutates Stage state. */
export const stageReducer = (state: StageState, a: StageAction): StageState => {
  switch (a.type) {
    case 'CAMERA':
      return { ...state, camera: a.camera };
    case 'VP':
      return { ...state, vp: a.vp };
    case 'LAYOUT':
      return { ...state, layout: a.layout, framing: a.layout === 'grid' ? 'canvas' : 'document' };
    case 'SPREAD':
      return { ...state, spread: a.spread };
    case 'FRAMING':
      return { ...state, framing: a.framing, zoomSpec: FRAMINGS[a.framing].zoom };
    case 'ZOOMSPEC':
      return { ...state, zoomSpec: a.zoomSpec };
    default:
      return state;
  }
};
