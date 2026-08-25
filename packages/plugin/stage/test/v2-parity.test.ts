import { describe, expect, it } from 'vitest';
import type { PluginContext } from '@embedpdf/core';
import { createStageCapability } from '../src/capability';
import { PT_TO_CSS_PX } from '../src/physical-scale';
import { initialStageState, stageReducer } from '../src/reducer';
import type { StageAction, StageCapability, StageConfig, StageState } from '../src/types';

function harness(
  pageCount: number,
  config: StageConfig = {},
  opts: { skipViewport?: boolean } = {},
) {
  const pages = Array.from({ length: pageCount }, (_, i) => ({
    index: i,
    pageObjectNumber: i + 1,
    size: { width: 600, height: 800 },
    rotation: 0 as const,
    label: null,
    userUnit: 1,
    boxes: {},
  }));
  const meta = { id: 'doc', name: 'doc', pageCount: pages.length, pages, revision: 0 };
  let state = initialStageState({ viewUnitsPerPoint: 1, ...config });
  let stage!: StageCapability;
  const ctx = {
    id: 'stage',
    documentId: 'doc',
    doc: null,
    getState: () => state,
    dispatch: (a: StageAction) => {
      state = stageReducer(state, a);
    },
    subscribe: () => () => {},
    document: () => meta,
  } as unknown as PluginContext<StageState, StageAction>;
  stage = createStageCapability(ctx, config);
  if (!opts.skipViewport) stage.setViewport({ width: 1000, height: 700 });
  return { stage, meta };
}

describe('usePhysicalScaling', () => {
  it('off (default): user === effective, getDpr() is 1', () => {
    const { stage } = harness(3, { zoom: { level: 1 } });
    stage.setDevicePixelRatio(2);
    expect(stage.getDpr()).toBe(1);
    expect(stage.zoomLevel()).toBeCloseTo(1);
    expect(stage.userZoomLevel()).toBeCloseTo(1);
    expect(stage.usePhysicalScaling()).toBe(false);
  });

  it('on: effective = user × (96/72) × dpr (viewUnitsPerPoint=1)', () => {
    const { stage } = harness(3, { zoom: { level: 1 }, usePhysicalScaling: true });
    stage.setDevicePixelRatio(2);
    expect(stage.getDpr()).toBeCloseTo(PT_TO_CSS_PX * 2);
    expect(stage.userZoomLevel()).toBeCloseTo(1);
    expect(stage.zoomLevel()).toBeCloseTo(PT_TO_CSS_PX * 2);
  });

  it('fit modes stay in CSS-pixel space (unaffected by the physical factor)', () => {
    const { stage } = harness(3, { zoom: { mode: 'fit-width' }, usePhysicalScaling: true });
    const fit = (1000 - 2 * 24) / 600;
    expect(stage.zoomLevel()).toBeCloseTo(fit, 4);
    stage.setDevicePixelRatio(2);
    expect(stage.zoomLevel()).toBeCloseTo(fit, 4); // still CSS-fit
    expect(stage.userZoomLevel()).toBeCloseTo(fit / stage.getDpr(), 4);
    expect(stage.zoomMode()).toBe('fit-width');
  });

  it('gesture commit stores user zoom so the next resolve does not double-apply', () => {
    const { stage } = harness(3, { zoom: { level: 1 }, usePhysicalScaling: true, bounded: false });
    stage.setDevicePixelRatio(2);
    const userBefore = stage.userZoomLevel();
    stage.beginGesture();
    stage.zoomAround({ x: 500, y: 350 }, 1.5);
    stage.endGesture();
    expect(stage.zoomMode()).toBe('custom');
    expect(stage.userZoomLevel()).toBeCloseTo(userBefore * 1.5, 3);
    // stored intent is user-space: a refit must not multiply getDpr() again
    const effective = stage.zoomLevel();
    stage.refit();
    expect(stage.zoomLevel()).toBeCloseTo(effective, 4);
    expect(stage.userZoomLevel()).toBeCloseTo(userBefore * 1.5, 3);
  });
});

describe('numeric default zoom on load/resize', () => {
  it('applies a numeric default once the viewport becomes non-zero', () => {
    const { stage } = harness(3, { zoom: { level: 1.5 } }, { skipViewport: true });
    expect(stage.zoomMode()).toBe('custom');
    stage.setViewport({ width: 1000, height: 0 }); // metrics still zero → not placed
    expect(stage.camera()).toEqual({ x: 0, y: 0, zoom: 1 });
    stage.setViewport({ width: 1000, height: 700 });
    expect(stage.zoomMode()).toBe('custom');
    expect(stage.zoomLevel()).toBeCloseTo(1.5);
    expect(stage.userZoomLevel()).toBeCloseTo(1.5);
  });

  it('resize keeps a numeric default — does not re-enter automatic', () => {
    const { stage } = harness(3, { zoom: { level: 1.25 } });
    expect(stage.zoomMode()).toBe('custom');
    stage.setViewport({ width: 800, height: 600 });
    expect(stage.zoomMode()).toBe('custom');
    expect(stage.zoomLevel()).toBeCloseTo(1.25);
  });

  it('refit on a numeric zoom re-anchors, never switches to a fit mode', () => {
    const { stage, meta } = harness(3, { zoom: { level: 0.8 } });
    meta.pages[0].rotation = 90;
    meta.revision = 1;
    stage.refit();
    expect(stage.zoomMode()).toBe('custom');
    expect(stage.zoomLevel()).toBeCloseTo(0.8);
  });

  it('fit/auto still re-resolves on resize (recalcAuto path)', () => {
    const { stage } = harness(3, { zoom: { mode: 'fit-width' }, responsive: [] });
    const z1 = stage.zoomLevel();
    stage.setViewport({ width: 500, height: 700 });
    expect(stage.zoomMode()).toBe('fit-width');
    expect(stage.zoomLevel()).not.toBeCloseTo(z1, 4);
    expect(stage.zoomLevel()).toBeCloseTo((500 - 2 * 24) / 600, 4);
  });
});

describe('wheel zoomStep', () => {
  it('defaults to 0.1 and uses sign(deltaY), not raw deltaY', () => {
    const { stage } = harness(3, { zoom: { level: 1 }, bounded: false });
    expect(stage.zoomStep()).toBe(0.1);
    const z0 = stage.zoomLevel();
    stage.wheelZoom({ x: 500, y: 350 }, 180); // large raw delta — still one 10% step
    expect(stage.zoomLevel()).toBeCloseTo(z0 * 0.9, 4);
    const afterOut = stage.zoomLevel();
    stage.wheelZoom({ x: 500, y: 350 }, -12); // tiny raw delta — still one 10% step in
    expect(stage.zoomLevel()).toBeCloseTo(afterOut * 1.1, 4);
  });

  it('honors a configured zoomStep', () => {
    const { stage } = harness(3, { zoom: { level: 1 }, zoomStep: 0.25, bounded: false });
    stage.wheelZoom({ x: 500, y: 350 }, 1);
    expect(stage.zoomLevel()).toBeCloseTo(0.75, 4);
  });
});

describe('smooth scroll max page distance + pre-warm', () => {
  it('jumps instantly and pre-warms when |Δpage| exceeds the cap', () => {
    const frames: Array<(t: number) => void> = [];
    const warmed: number[][] = [];
    const scheduler = {
      raf: (cb: (t: number) => void) => {
        frames.push(cb);
        return frames.length;
      },
      caf: () => {},
    };
    const { stage } = harness(12, {
      scheduler,
      prewarmPages: (pages) => warmed.push([...pages]),
    });
    expect(stage.smoothScrollMaxPageDistance()).toBe(5);
    stage.goToPage(10); // |10−0| = 10 > 5 → instant
    expect(frames.length).toBe(0);
    expect(stage.currentPage()).toBe(10);
    expect(warmed.length).toBe(1);
    expect(warmed[0]).toContain(10);
  });

  it('keeps the tween when |Δpage| is within the cap', () => {
    const frames: Array<(t: number) => void> = [];
    const scheduler = {
      raf: (cb: (t: number) => void) => {
        frames.push(cb);
        return frames.length;
      },
      caf: () => {},
    };
    const { stage } = harness(12, { scheduler });
    stage.goToPage(3); // 3 ≤ 5 → smooth
    expect(frames.length).toBeGreaterThan(0);
    expect(stage.currentPage()).toBe(3);
  });

  it('Infinity = always smooth, even across the whole document', () => {
    const frames: Array<(t: number) => void> = [];
    const warmed: number[][] = [];
    const scheduler = {
      raf: (cb: (t: number) => void) => {
        frames.push(cb);
        return frames.length;
      },
      caf: () => {},
    };
    const { stage } = harness(12, {
      scheduler,
      smoothScrollMaxPageDistance: Infinity,
      prewarmPages: (pages) => warmed.push([...pages]),
    });
    stage.goToPage(11);
    expect(frames.length).toBeGreaterThan(0);
    expect(warmed.length).toBe(0);
  });

  it('explicit instant on a long jump still pre-warms', () => {
    const frames: Array<(t: number) => void> = [];
    const warmed: number[][] = [];
    const scheduler = {
      raf: (cb: (t: number) => void) => {
        frames.push(cb);
        return frames.length;
      },
      caf: () => {},
    };
    const { stage } = harness(12, {
      scheduler,
      prewarmPages: (pages) => warmed.push([...pages]),
    });
    stage.goToPage(11, { behavior: 'instant' });
    expect(frames.length).toBe(0);
    expect(warmed.length).toBe(1);
    expect(warmed[0]).toContain(11);
  });
});
