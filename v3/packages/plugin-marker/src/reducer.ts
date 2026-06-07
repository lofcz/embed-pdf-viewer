import type { MarkerAction, MarkerState } from './types';

export const initialMarkerState: MarkerState = { byPage: {}, selected: null, seq: 0 };

const EMPTY: never[] = [];

export const markerReducer = (state: MarkerState, a: MarkerAction): MarkerState => {
  switch (a.type) {
    case 'ADD': {
      const list = state.byPage[a.marker.pon] ?? EMPTY;
      return {
        ...state,
        byPage: { ...state.byPage, [a.marker.pon]: [...list, a.marker] },
        selected: a.marker.id,
        seq: state.seq + 1,
      };
    }
    case 'SELECT':
      return { ...state, selected: a.id };
    case 'REMOVE': {
      const byPage: Record<number, (typeof state.byPage)[number]> = {};
      for (const k of Object.keys(state.byPage))
        byPage[+k] = state.byPage[+k].filter((m) => m.id !== a.id);
      return { ...state, byPage, selected: state.selected === a.id ? null : state.selected };
    }
    default:
      return state;
  }
};
