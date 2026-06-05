/**
 * @embedpdf/plugin-marker — a deliberately tiny "annotation" feature plugin.
 *
 * It demonstrates the feature-plugin pattern: a pure slice + a typed capability,
 * page-space coordinates only, zero framework code. The React view + menu live in
 * the framework adapter and read this capability. It never imports the Stage's
 * internals — at most it would call Stage intents (e.g. goToPage) via a token.
 */
import { createCapabilityToken, definePlugin } from '@embedpdf/kernel';
import type { PluginContext } from '@embedpdf/kernel';

export interface Marker {
  id: string;
  page: number;
  x: number; // page coordinates (PDF units)
  y: number;
}

export interface MarkerState {
  byPage: Record<number, Marker[]>;
  selected: string | null;
  seq: number;
}

export type MarkerAction =
  | { type: 'ADD'; marker: Marker }
  | { type: 'SELECT'; id: string | null }
  | { type: 'REMOVE'; id: string };

export interface MarkerCapability {
  forPage(pageIndex: number): Marker[];
  selectedId(): string | null;
  selectedMarker(): Marker | null;
  add(pageIndex: number, pt: { x: number; y: number }): void;
  select(id: string | null): void;
  remove(id: string): void;
}

export const MarkerToken = createCapabilityToken<MarkerCapability>('marker');

const EMPTY: Marker[] = [];

export const markerPlugin = () =>
  definePlugin<MarkerState, MarkerAction, MarkerCapability>({
    id: 'marker',
    token: MarkerToken,
    initialState: { byPage: {}, selected: null, seq: 0 },
    reduce(state, a): MarkerState {
      switch (a.type) {
        case 'ADD': {
          const list = state.byPage[a.marker.page] ?? EMPTY;
          return {
            ...state,
            byPage: { ...state.byPage, [a.marker.page]: [...list, a.marker] },
            selected: a.marker.id,
            seq: state.seq + 1,
          };
        }
        case 'SELECT':
          return { ...state, selected: a.id };
        case 'REMOVE': {
          const byPage: Record<number, Marker[]> = {};
          for (const k of Object.keys(state.byPage)) {
            byPage[+k] = state.byPage[+k].filter((m) => m.id !== a.id);
          }
          return { ...state, byPage, selected: state.selected === a.id ? null : state.selected };
        }
        default:
          return state;
      }
    },
    capability(ctx: PluginContext<MarkerState, MarkerAction>): MarkerCapability {
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
    },
  });
