import { ZoomMode, type Overscroll, type ZoomSpec } from '@embedpdf-x/stage-core';
import type { FramingKind } from './types';

/** World units between pages (and between the two halves of a spread). */
export const GAP = 16;

/** A framing preset bundles the orthogonal primitives: bounds, home, margin, zoom. */
export interface FramingPreset {
  bounded: boolean;
  overscroll: Overscroll;
  home: 'start' | 'center';
  margin: number;
  zoom: ZoomSpec;
}

export const FRAMINGS: Record<FramingKind, FramingPreset> = {
  // Adobe-like: page at the top with a margin; scroll past ends to centre any page.
  document: {
    bounded: true,
    overscroll: 'center',
    home: 'start',
    margin: 24,
    zoom: { mode: ZoomMode.Automatic },
  },
  // Construction-like: page centred, infinite free pan/zoom.
  canvas: {
    bounded: false,
    overscroll: 0,
    home: 'center',
    margin: 0,
    zoom: { mode: ZoomMode.FitPage },
  },
};
