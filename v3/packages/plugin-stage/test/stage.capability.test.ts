import { describe, expect, it } from 'vitest';
import type { PluginContext } from '@embedpdf-x/kernel';
import { createStageCapability } from '../src/capability';
import { initialStageState, stageReducer } from '../src/reducer';
import type { StageAction, StageConfig, StageState } from '../src/types';

/**
 * Kernel-free harness: drive the real capability against the real reducer + real
 * stage-core, with a fake document and an injectable scheduler. No DOM, no async —
 * the whole Stage is deterministically testable because the core is pure.
 */
function harness(sizes: Array<{ width: number; height: number }>, config: StageConfig = {}) {
  const pages = sizes.map((s, i) => ({
    index: i,
    pageObjectNumber: i + 1,
    width: s.width,
    height: s.height,
    rotation: 0,
    label: null,
    userUnit: 1,
    boxes: {},
  }));
  const meta = { id: 'doc', name: 'doc', pageCount: pages.length, pages };
  let state = initialStageState(config);
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

  const stage = createStageCapability(ctx, config);
  // Mirror the real lifecycle: report the viewport, then place the initial view.
  stage.setViewport({ width: 1000, height: 700 });
  stage.placeInitial();
  return { stage };
}

const PORTRAIT = Array.from({ length: 5 }, () => ({ width: 600, height: 800 }));
const GAP = 16;

describe('goToPage', () => {
  it('scrolls to the TOP of the page, not its centre (vertical, home=start)', () => {
    const { stage } = harness(PORTRAIT);
    stage.goToPage(2, { behavior: 'instant' });
    expect(stage.currentPage()).toBe(2);
    const box = stage.pageRect(3)!; // pon = index + 1
    // the page's top edge sits ~margin px below the viewport top
    expect(stage.toScreen({ x: box.x, y: box.y }).y).toBeCloseTo(24, 0);
  });
});

describe('fit modes use the document max page (not the current page)', () => {
  const MIXED = [
    { width: 600, height: 800 },
    { width: 600, height: 800 },
    { width: 2000, height: 800 }, // the widest
    { width: 600, height: 3000 }, // the tallest
  ];
  it('automatic fits the doc max WIDTH (capped at 100%), from the current page', () => {
    const { stage } = harness(MIXED);
    stage.goToPage(0, { behavior: 'instant' }); // sit on a narrow page…
    stage.automatic();
    // …zoom derives from the document's max width (2000), width-only, capped at 100%
    expect(stage.zoomLevel()).toBeCloseTo((1000 - 2 * GAP) / 2000, 4);
  });
  it('fit-width and fit-page use max width / max height', () => {
    const { stage } = harness(MIXED);
    stage.fitWidth();
    expect(stage.zoomLevel()).toBeCloseTo((1000 - 2 * GAP) / 2000, 4);
    stage.fitPage();
    expect(stage.zoomLevel()).toBeCloseTo(
      Math.min((1000 - 2 * GAP) / 2000, (700 - 2 * GAP) / 3000),
      4,
    );
  });
});

describe('anchor-preserving transitions', () => {
  it('keeps the current page when switching layout', () => {
    const { stage } = harness(PORTRAIT);
    stage.goToPage(3, { behavior: 'instant' });
    expect(stage.currentPage()).toBe(3);
    stage.setLayout('horizontal');
    expect(stage.currentPage()).toBe(3);
  });

  it('re-fits fit-width on viewport resize and keeps the page', () => {
    const { stage } = harness([
      { width: 2000, height: 800 },
      { width: 2000, height: 800 },
      { width: 2000, height: 800 },
    ]);
    stage.goToPage(1, { behavior: 'instant' });
    stage.fitWidth();
    const z1 = stage.zoomLevel();
    stage.setViewport({ width: 2000, height: 700 }); // wider viewport
    const z2 = stage.zoomLevel();
    expect(z2).toBeGreaterThan(z1);
    expect(z2 / z1).toBeCloseTo((2000 - 2 * GAP) / (1000 - 2 * GAP), 2);
    expect(stage.currentPage()).toBe(1);
  });
});

describe('bounded primitive', () => {
  it('bounded on clamps the camera to the content', () => {
    const { stage } = harness(PORTRAIT);
    stage.setCamera({ x: 0, y: 99999, zoom: 1 });
    expect(stage.camera().y).toBeLessThan(99999);
  });
  it('bounded off lets the camera pan freely (infinite canvas)', () => {
    const { stage } = harness(PORTRAIT);
    stage.setBounded(false);
    stage.setCamera({ x: 99999, y: 99999, zoom: 1 });
    expect(stage.camera()).toEqual({ x: 99999, y: 99999, zoom: 1 });
  });
});

describe('update()', () => {
  it('applies several settings in one change', () => {
    const { stage } = harness(PORTRAIT);
    stage.update({ layout: 'grid', bounded: false, zoom: { mode: 'fit-page' } });
    expect(stage.layout()).toBe('grid');
    expect(stage.bounded()).toBe(false);
    expect(stage.zoomMode()).toBe('fit-page');
  });
});

describe('sizing: uniform + fit-width = flush per-page fit', () => {
  const MIXED = [
    { width: 600, height: 800 },
    { width: 1000, height: 700 },
    { width: 500, height: 900 },
  ];
  it('every page fills the same pane width, and the per-page scale is paneW/pageW', () => {
    const { stage } = harness(MIXED, { sizing: 'uniform' });
    stage.fitWidth();
    const zoom = stage.zoomLevel();
    // all items are uniform width ⇒ same on-screen width = pane width minus gaps
    const onScreenW = (pon: number) => stage.pageRect(pon)!.width * zoom;
    expect(onScreenW(1)).toBeCloseTo(1000 - 2 * GAP, 4);
    expect(onScreenW(2)).toBeCloseTo(1000 - 2 * GAP, 4);
    expect(onScreenW(3)).toBeCloseTo(1000 - 2 * GAP, 4);
    // the GitHub formula: effective per-page scale = contentScale*zoom = paneW/intrinsicW
    const effective = (pon: number) => stage.pageRect(pon)!.contentScale * zoom;
    expect(effective(1)).toBeCloseTo((1000 - 2 * GAP) / 600, 4); // page 1 intrinsic width 600
    expect(effective(2)).toBeCloseTo((1000 - 2 * GAP) / 1000, 4);
    expect(effective(3)).toBeCloseTo((1000 - 2 * GAP) / 500, 4);
  });
});

describe('flow: paged (same scene, smaller clamp rect — no index state)', () => {
  it('renders only the current item; next/prev step by item', () => {
    const { stage } = harness(PORTRAIT, { flow: 'paged' });
    expect(stage.flow()).toBe('paged');
    expect(stage.visiblePages().map((p) => p.pageIndex)).toEqual([0]);
    expect(stage.currentPage()).toBe(0);
    stage.next({ behavior: 'instant' });
    expect(stage.currentPage()).toBe(1);
    expect(stage.visiblePages().map((p) => p.pageIndex)).toEqual([1]);
    stage.next({ behavior: 'instant' });
    stage.prev({ behavior: 'instant' });
    expect(stage.currentPage()).toBe(1);
  });

  it('a pan cannot escape the current item', () => {
    const { stage } = harness(PORTRAIT, { flow: 'paged' });
    stage.next({ behavior: 'instant' }); // page 1
    stage.panBy(0, -100000); // try to scroll far past the page bottom
    expect(stage.currentPage()).toBe(1); // clamped to page 1's rect
    expect(stage.visiblePages().map((p) => p.pageIndex)).toEqual([1]);
  });

  it('fit-width fits the CURRENT page width, not the document max', () => {
    const { stage } = harness(
      [
        { width: 600, height: 800 },
        { width: 2000, height: 800 },
      ],
      { flow: 'paged' },
    );
    stage.goToPage(0, { behavior: 'instant' });
    stage.fitWidth();
    expect(stage.zoomLevel()).toBeCloseTo((1000 - 2 * GAP) / 600, 4); // current page (600)
    stage.goToPage(1, { behavior: 'instant' });
    stage.fitWidth();
    expect(stage.zoomLevel()).toBeCloseTo((1000 - 2 * GAP) / 2000, 4); // current page (2000)
  });

  it('spread paged shows a spread (two pages) as the current item', () => {
    const { stage } = harness(PORTRAIT, { flow: 'paged', spread: 'odd' });
    expect(stage.currentItemPages()).toEqual([0, 1]);
    expect(
      stage
        .visiblePages()
        .map((p) => p.pageIndex)
        .sort(),
    ).toEqual([0, 1]);
    stage.next({ behavior: 'instant' });
    expect(stage.currentItemPages()).toEqual([2, 3]);
  });

  it('toggling flow keeps the current page (no index, page-durable handoff)', () => {
    const { stage } = harness(PORTRAIT); // continuous
    stage.goToPage(3, { behavior: 'instant' });
    expect(stage.currentPage()).toBe(3);
    stage.setFlow('paged');
    expect(stage.flow()).toBe('paged');
    expect(stage.currentPage()).toBe(3);
    expect(stage.visiblePages().map((p) => p.pageIndex)).toEqual([3]);
    stage.setFlow('continuous');
    expect(stage.currentPage()).toBe(3);
  });

  it('pages() exposes the page list with PDF labels', () => {
    const { stage } = harness(PORTRAIT);
    const pages = stage.pages();
    expect(pages.length).toBe(5);
    expect(pages[0]).toMatchObject({ index: 0, pon: 1 });
  });

  // The Option 2 property: paged is a one-item slice, so the page is structural and
  // CANNOT be replaced by panning — even when unbounded (construction / infinite canvas).
  it('paged + unbounded: panning far NEVER changes the page (construction)', () => {
    const { stage } = harness(PORTRAIT, { flow: 'paged', bounded: false });
    stage.goToPage(2, { behavior: 'instant' });
    expect(stage.currentPage()).toBe(2);
    expect(stage.visiblePages().map((p) => p.pageIndex)).toEqual([2]);
    // pan a huge distance every direction — unbounded, the camera roams freely
    stage.panBy(0, -50000);
    stage.panBy(0, -50000);
    stage.panBy(-40000, 0);
    expect(stage.currentPage()).toBe(2); // still page 2
    expect(stage.visiblePages().map((p) => p.pageIndex)).toEqual([2]); // never replaced
  });

  it('paged cursor round-trips through viewState (restore lands on the same page)', () => {
    const { stage } = harness(PORTRAIT, { flow: 'paged' });
    stage.goToPage(3, { behavior: 'instant' });
    const vs = stage.viewState();
    expect(vs.cursor).toBe(3);
    const { stage: restored } = harness(PORTRAIT, { flow: 'paged' });
    restored.applyViewState(vs);
    expect(restored.currentPage()).toBe(3);
    expect(restored.visiblePages().map((p) => p.pageIndex)).toEqual([3]);
  });
});

describe('smooth scroll via the injected scheduler', () => {
  it('tweens to the target across frames (deterministic, no real time)', () => {
    const frames: Array<(t: number) => void> = [];
    const scheduler = {
      raf: (cb: (t: number) => void) => {
        frames.push(cb);
        return frames.length;
      },
      caf: () => {},
    };
    const { stage } = harness(PORTRAIT, { scheduler });
    expect(frames.length).toBe(0); // placement was instant

    stage.goToPage(4); // smooth (default)
    expect(frames.length).toBeGreaterThan(0);

    const run = (t: number) => frames.splice(0).forEach((cb) => cb(t));
    run(0); // first frame: k = 0
    run(120); // mid
    run(240); // final: k = 1 → at target
    expect(stage.currentPage()).toBe(4);
  });
});
