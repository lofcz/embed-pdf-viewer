import { definePlugin } from '@embedpdf/kernel';
import { createMarkerCapability } from './capability';
import { initialMarkerState, markerReducer } from './reducer';
import { MarkerToken } from './types';
import type { MarkerAction, MarkerCapability, MarkerState } from './types';

/** A leaf feature plugin: state + capability, no dependencies, no effects. */
export const markerPlugin = () =>
  definePlugin<MarkerState, MarkerAction, MarkerCapability>({
    id: 'marker',
    token: MarkerToken,
    initialState: initialMarkerState,
    reduce: markerReducer,
    capability: createMarkerCapability,
  });
