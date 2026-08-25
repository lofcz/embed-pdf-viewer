import { describe, expect, it } from 'vitest';
import {
  PT_TO_CSS_PX,
  cameraToUserZoom,
  physicalDpr,
  userToCameraZoom,
  wheelZoomFactor,
} from '../src/physical-scale';

describe('physicalDpr (v2 getDpr)', () => {
  it('returns 1 when usePhysicalScaling is false', () => {
    expect(physicalDpr(false, 2)).toBe(1);
    expect(physicalDpr(false, 3)).toBe(1);
    expect(physicalDpr(false, 0)).toBe(1);
  });

  it('returns (96/72) × devicePixelRatio when on', () => {
    expect(physicalDpr(true, 1)).toBeCloseTo(96 / 72);
    expect(physicalDpr(true, 2)).toBeCloseTo((96 / 72) * 2);
    expect(physicalDpr(true, 1.5)).toBeCloseTo((96 / 72) * 1.5);
  });

  it('falls back to 96/72 when devicePixelRatio is 0', () => {
    expect(physicalDpr(true, 0)).toBeCloseTo(96 / 72);
  });

  it('A4 width at 100% zoom, DPR=1 → ~794 CSS px', () => {
    const a4Pts = (210 * 72) / 25.4;
    expect(a4Pts * physicalDpr(true, 1)).toBeCloseTo(793.7, 0);
  });
});

describe('user ↔ camera conversion', () => {
  it('is identity when physical scaling is off', () => {
    expect(userToCameraZoom(1.5, false, 2, 96 / 72)).toBe(1.5);
    expect(cameraToUserZoom(1.5, false, 2, 96 / 72)).toBe(1.5);
  });

  it('with viewUnitsPerPoint=1 (test layout): user 1, DPR=1 → camera ≈ 1.333', () => {
    const cam = userToCameraZoom(1, true, 1, 1);
    expect(cam).toBeCloseTo(PT_TO_CSS_PX);
    expect(cameraToUserZoom(cam, true, 1, 1)).toBeCloseTo(1);
  });

  it('does not double-apply 96/72 when viewUnitsPerPoint already is 96/72', () => {
    // v3 default layout: pages are already 96/72 world-per-point. Camera zoom
    // should only pick up the remaining DPR factor.
    expect(userToCameraZoom(1, true, 2, 96 / 72)).toBeCloseTo(2);
    expect(cameraToUserZoom(2, true, 2, 96 / 72)).toBeCloseTo(1);
  });

  it('gesture commit: divide effective by getDpr() so the next resolve does not double-apply', () => {
    const initialEffective = userToCameraZoom(1, true, 2, 1); // ~2.667
    const dpr = physicalDpr(true, 2);
    const initialUser = initialEffective / dpr; // v2 pinch: initialZoom / getDpr()
    expect(initialUser).toBeCloseTo(1);
    const scale = 1.5;
    const delta = (scale - 1) * initialUser;
    expect(delta).toBeCloseTo(0.5);
  });
});

describe('wheelZoomFactor (v2 ZoomGestureOptions)', () => {
  it('uses sign(deltaY) × zoomStep, default 0.1', () => {
    expect(wheelZoomFactor(120)).toBeCloseTo(0.9);
    expect(wheelZoomFactor(-80)).toBeCloseTo(1.1);
    expect(wheelZoomFactor(1, 0.25)).toBeCloseTo(0.75);
    expect(wheelZoomFactor(0)).toBe(1);
  });
});
