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
const PAD = 24; // default StageSettings.padding — the fit inset + arrival gutter

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
    expect(stage.zoomLevel()).toBeCloseTo((1000 - 2 * PAD) / 2000, 4);
  });
  it('fit-width and fit-page use max width / max height', () => {
    const { stage } = harness(MIXED);
    stage.fitWidth();
    expect(stage.zoomLevel()).toBeCloseTo((1000 - 2 * PAD) / 2000, 4);
    stage.fitPage();
    expect(stage.zoomLevel()).toBeCloseTo(
      Math.min((1000 - 2 * PAD) / 2000, (700 - 2 * PAD) / 3000),
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
    expect(z2 / z1).toBeCloseTo((2000 - 2 * PAD) / (1000 - 2 * PAD), 2);
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
    expect(onScreenW(1)).toBeCloseTo(1000 - 2 * PAD, 4);
    expect(onScreenW(2)).toBeCloseTo(1000 - 2 * PAD, 4);
    expect(onScreenW(3)).toBeCloseTo(1000 - 2 * PAD, 4);
    // the GitHub formula: effective per-page scale = contentScale*zoom = paneW/intrinsicW
    const effective = (pon: number) => stage.pageRect(pon)!.contentScale * zoom;
    expect(effective(1)).toBeCloseTo((1000 - 2 * PAD) / 600, 4); // page 1 intrinsic width 600
    expect(effective(2)).toBeCloseTo((1000 - 2 * PAD) / 1000, 4);
    expect(effective(3)).toBeCloseTo((1000 - 2 * PAD) / 500, 4);
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
    expect(stage.zoomLevel()).toBeCloseTo((1000 - 2 * PAD) / 600, 4); // current page (600)
    stage.goToPage(1, { behavior: 'instant' });
    stage.fitWidth();
    expect(stage.zoomLevel()).toBeCloseTo((1000 - 2 * PAD) / 2000, 4); // current page (2000)
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

describe('placement duality: center when it fits, start when it overflows', () => {
  it('zoomed OUT, goToPage centers the page in the viewport', () => {
    const { stage } = harness(PORTRAIT);
    stage.zoomTo({ level: 0.5 }); // page = 300x400, fits — but page 2 is OFF-screen
    stage.goToPage(2, { behavior: 'instant' });
    const box = stage.pageRect(3)!;
    const center = stage.toScreen({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(center.x).toBeCloseTo(500, 0);
    expect(center.y).toBeCloseTo(350, 0);
  });

  it('zoomed IN, goToPage goes to the page top-left (a padding out)', () => {
    const { stage } = harness(PORTRAIT);
    stage.zoomTo({ level: 2 }); // page = 1200x1600, overflows both axes
    stage.goToPage(2, { behavior: 'instant' });
    const box = stage.pageRect(3)!;
    const topLeft = stage.toScreen({ x: box.x, y: box.y });
    expect(topLeft.x).toBeCloseTo(PAD, 0);
    expect(topLeft.y).toBeCloseTo(PAD, 0);
  });
});

describe('navigation units: spread when it fits, page when zoomed in', () => {
  // spread (cover): items [0], [1,2], [3,4]
  it('zoomed out (fit-page): next steps by SPREAD — 0 → 1 → 3', () => {
    const { stage } = harness(PORTRAIT, { spread: 'even' });
    stage.fitPage();
    stage.goToPage(0, { behavior: 'instant' });
    stage.next({ behavior: 'instant' });
    expect(stage.currentPage()).toBe(1);
    stage.next({ behavior: 'instant' });
    expect(stage.currentPage()).toBe(3); // skipped 2: pages 1+2 were one unit
    stage.prev({ behavior: 'instant' });
    expect(stage.currentPage()).toBe(1);
  });

  it('zoomed in: next steps by PAGE — 0 → 1 → 2 → 3, landing top-LEFT of each page', () => {
    const { stage } = harness(PORTRAIT, { spread: 'even' });
    stage.zoomTo({ level: 2 });
    stage.goToPage(0, { behavior: 'instant' });
    stage.next({ behavior: 'instant' });
    expect(stage.currentPage()).toBe(1);
    // landed at PAGE 1's start — not the spread's horizontal center (the old bug)
    const box1 = stage.pageRect(2)!; // pon 2 = page index 1
    expect(stage.toScreen({ x: box1.x, y: box1.y }).x).toBeCloseTo(PAD, 0);
    stage.next({ behavior: 'instant' });
    expect(stage.currentPage()).toBe(2); // walks INTO the spread
    stage.next({ behavior: 'instant' });
    expect(stage.currentPage()).toBe(3);
  });

  it('paged + spread zoomed in: walks pages within the spread, then flips', () => {
    const { stage } = harness(PORTRAIT, { flow: 'paged', spread: 'even' });
    stage.goToPage(1, { behavior: 'instant' }); // spread [1,2]
    stage.zoomTo({ level: 2 });
    stage.next({ behavior: 'instant' });
    expect(stage.currentPage()).toBe(2); // same spread, camera moved to page 2
    expect(stage.currentItemPages()).toEqual([1, 2]);
    stage.next({ behavior: 'instant' });
    expect(stage.currentPage()).toBe(3); // flipped to spread [3,4]
    expect(stage.currentItemPages()).toEqual([3, 4]);
  });
});

describe('cursor is THE current page in both flows', () => {
  it('continuous: scrolling syncs the cursor (indicator follows the camera)', () => {
    const { stage } = harness(PORTRAIT);
    expect(stage.currentPage()).toBe(0);
    stage.panBy(0, -900); // scroll down ~a page
    expect(stage.currentPage()).toBe(1);
  });

  it('zoomed out, next/prev always progress (never stuck on a visible page)', () => {
    const { stage } = harness(PORTRAIT);
    stage.fitAll(); // everything visible — the old model could never leave page 0
    stage.goToPage(0, { behavior: 'instant' }); // pin the indicator to page 0
    const before = stage.camera();
    stage.next({ behavior: 'instant' });
    expect(stage.currentPage()).toBe(1);
    stage.next({ behavior: 'instant' });
    expect(stage.currentPage()).toBe(2);
    // STRUCTURAL no-op (not a visibility condition): under fit-all the canonical
    // placement is the centered scene, and that doesn't change between steps.
    expect(stage.camera()).toEqual(before);
  });
});

describe('fit-all (the construction overview)', () => {
  it('fits and centers the WHOLE scene', () => {
    const { stage } = harness(PORTRAIT, { layout: 'grid', bounded: false });
    stage.fitAll();
    const v = stage.viewport();
    const center = stage.toWorld({ x: v.width / 2, y: v.height / 2 });
    // viewport center = scene center, and every page is on screen
    const all = stage.visiblePages();
    expect(all.length).toBe(5);
    const sceneW = Math.max(...all.map((p) => p.x + p.width));
    const sceneH = Math.max(...all.map((p) => p.y + p.height));
    expect(center.x).toBeCloseTo(sceneW / 2, 0);
    expect(center.y).toBeCloseTo(sceneH / 2, 0);
    expect(sceneW * stage.zoomLevel()).toBeLessThanOrEqual(v.width - 2 * PAD + 1);
    expect(sceneH * stage.zoomLevel()).toBeLessThanOrEqual(v.height - 2 * PAD + 1);
  });
});

describe('cursor is INTENT: a clamped camera never revokes navigation', () => {
  // The reported bug: horizontal, bounded, ~113% — pages near the document edges
  // can't be centered, and the old camera-sync stole the cursor right back.
  const FOUR = Array.from({ length: 4 }, () => ({ width: 600, height: 800 }));
  const config = { layout: 'horizontal' as const, zoom: { level: 1.13 } };

  it('opens on page 1 — not on whatever page the clamped camera centers', () => {
    const { stage } = harness(FOUR, config);
    expect(stage.currentPage()).toBe(0); // intent: the start — even though the
    // viewport center sits over page 2 when the camera is pinned to the left edge
  });

  it('walks 1→2→3→4 and back 4→3→2→1, with the edges clamped', () => {
    const { stage } = harness(FOUR, config);
    const go = (dir: 'next' | 'prev') => stage[dir]({ behavior: 'instant' });

    go('next');
    expect(stage.currentPage()).toBe(1);
    go('next');
    expect(stage.currentPage()).toBe(2);
    go('next');
    expect(stage.currentPage()).toBe(3); // camera clamps at the right edge…
    const rightEdge = stage.camera().x;
    expect(rightEdge).toBeCloseTo(2448 - (1000 - 24) / 1.13, 0); // …but the cursor stays 4

    go('prev');
    expect(stage.currentPage()).toBe(2); // symmetric on the way back
    go('prev');
    expect(stage.currentPage()).toBe(1);
    go('prev');
    expect(stage.currentPage()).toBe(0); // page 1 is reachable again
    expect(stage.camera().x).toBeCloseTo(-24 / 1.13, 0); // clamped at the left edge
  });

  it('manipulation still derives the cursor (pan → indicator follows)', () => {
    const { stage } = harness(FOUR, config);
    expect(stage.currentPage()).toBe(0);
    stage.panBy(-700, 0); // user scrolls right
    expect(stage.currentPage()).toBeGreaterThan(0); // derived from the camera
  });

  it('navigation is CANONICAL: visible-but-off-center targets still settle into place', () => {
    // The 95% symptom: page fits the viewport (fits both axes at 0.8), you're at the
    // right edge, the target is visible but off-center — prev must still center it,
    // exactly as it would at 115%. No visibility-dependent behavior.
    const { stage } = harness(FOUR, { layout: 'horizontal', zoom: { level: 0.8 } });
    stage.goToPage(3, { behavior: 'instant' }); // camera clamps at the right edge
    stage.prev({ behavior: 'instant' }); // page 3 (idx 2) is visible but off-center
    expect(stage.currentPage()).toBe(2);
    const box = stage.pageRect(3)!; // pon 3 = page index 2
    const center = stage.toScreen({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(center.x).toBeCloseTo(500, 0); // …and it settled into its canonical place
  });

  it('a smooth tween never flickers the cursor off its target', () => {
    const frames: Array<(t: number) => void> = [];
    const scheduler = {
      raf: (cb: (t: number) => void) => {
        frames.push(cb);
        return frames.length;
      },
      caf: () => {},
    };
    const { stage } = harness(FOUR, { ...config, scheduler });
    stage.goToPage(3); // smooth
    expect(stage.currentPage()).toBe(3); // intent holds immediately
    const run = (t: number) => frames.splice(0).forEach((cb) => cb(t));
    run(0);
    run(120);
    expect(stage.currentPage()).toBe(3); // …and mid-tween
    run(240);
    expect(stage.currentPage()).toBe(3); // …and at the end
  });
});

describe('align: arrival alignment on overflowing axes', () => {
  it("RTL ({x:'end'}): zoomed-in navigation lands top-RIGHT", () => {
    const { stage } = harness(PORTRAIT, { align: { x: 'end', y: 'start' }, zoom: { level: 2 } });
    stage.goToPage(2, { behavior: 'instant' });
    const box = stage.pageRect(3)!;
    // page right edge sits a padding in from the viewport right edge; top a padding down
    expect(stage.toScreen({ x: box.x + box.width, y: box.y }).x).toBeCloseTo(1000 - PAD, 0);
    expect(stage.toScreen({ x: box.x, y: box.y }).y).toBeCloseTo(PAD, 0);
  });

  it('Drawboard ({center,center}): zoomed-in navigation centers the page', () => {
    const { stage } = harness(PORTRAIT, {
      align: { x: 'center', y: 'center' },
      zoom: { level: 2 },
      bounded: false, // construction feel — and proves placement needs no real clamp
    });
    stage.goToPage(2, { behavior: 'instant' });
    const box = stage.pageRect(3)!;
    const center = stage.toScreen({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(center.x).toBeCloseTo(500, 0);
    expect(center.y).toBeCloseTo(350, 0);
  });

  it('align is runtime-changeable and only affects the NEXT arrival', () => {
    const { stage } = harness(PORTRAIT, { zoom: { level: 2 } });
    stage.goToPage(1, { behavior: 'instant' });
    const before = stage.camera();
    stage.setAlign({ x: 'end', y: 'start' });
    expect(stage.camera()).toEqual(before); // no camera jump on the setting change
    stage.goToPage(2, { behavior: 'instant' });
    const box = stage.pageRect(3)!;
    expect(stage.toScreen({ x: box.x + box.width, y: box.y }).x).toBeCloseTo(1000 - PAD, 0);
  });
});

describe('gap: one value between items, every layout', () => {
  it('vertical layout: page 2 starts page-height + gap below page 1', () => {
    const { stage } = harness(PORTRAIT, { gap: 40 });
    expect(stage.pageRect(1)!.y).toBe(0);
    expect(stage.pageRect(2)!.y).toBeCloseTo(800 + 40, 6);
  });

  it('grid layout uses the SAME gap (no hidden 56)', () => {
    const { stage } = harness(PORTRAIT, { layout: 'grid', gap: 40 });
    const a = stage.pageRect(1)!;
    const b = stage.pageRect(2)!; // next column, same row
    expect(b.x - (a.x + a.width)).toBeCloseTo(40, 6);
  });

  it('gap is structural: changing it reflows but keeps the current page', () => {
    const { stage } = harness(PORTRAIT);
    stage.goToPage(3, { behavior: 'instant' });
    stage.setGap(64);
    expect(stage.currentPage()).toBe(3);
    expect(stage.pageRect(2)!.y).toBeCloseTo(800 + 64, 6); // scene rebuilt with the new gap
  });
});

describe('direction: rtl — layout flips, navigation does not', () => {
  it('horizontal rtl: page 1 starts at the right; next moves the camera LEFT; cursor walks 0→1→2', () => {
    const { stage } = harness(PORTRAIT, {
      layout: 'horizontal',
      direction: 'rtl',
      zoom: { level: 1.13 },
    });
    expect(stage.currentPage()).toBe(0);
    // page 1 is the RIGHTMOST item in the scene
    const first = stage.pageRect(1)!;
    const last = stage.pageRect(5)!;
    expect(first.x).toBeGreaterThan(last.x);
    const x0 = stage.camera().x;
    stage.next({ behavior: 'instant' });
    expect(stage.currentPage()).toBe(1); // index-based navigation: unchanged
    expect(stage.camera().x).toBeLessThan(x0); // …but the camera moved LEFT
    stage.next({ behavior: 'instant' });
    expect(stage.currentPage()).toBe(2);
  });

  it('vertical rtl + spread: page 1 binds on the right (all flows)', () => {
    const { stage } = harness(PORTRAIT, { spread: 'odd', direction: 'rtl' });
    expect(stage.pageRect(1)!.x).toBeGreaterThan(stage.pageRect(2)!.x);
    // paged too: the slice inherits the swap
    stage.setFlow('paged');
    expect(stage.pageRect(1)!.x).toBeGreaterThan(stage.pageRect(2)!.x);
  });

  it('logical align: the default start/start lands top-RIGHT in rtl (no auto needed)', () => {
    const { stage } = harness(PORTRAIT, { direction: 'rtl', zoom: { level: 2 } });
    stage.goToPage(2, { behavior: 'instant' });
    const box = stage.pageRect(3)!;
    expect(stage.toScreen({ x: box.x + box.width, y: box.y }).x).toBeCloseTo(1000 - PAD, 0);
    expect(stage.toScreen({ x: box.x, y: box.y }).y).toBeCloseTo(PAD, 0);
  });

  it('switching direction keeps the current page (structural, anchor-preserving)', () => {
    const { stage } = harness(PORTRAIT, { layout: 'horizontal' });
    stage.goToPage(3, { behavior: 'instant' });
    stage.setDirection('rtl');
    expect(stage.direction()).toBe('rtl');
    expect(stage.currentPage()).toBe(3);
  });

  it('grid rtl: first page top-right, scene query renders the right pages', () => {
    const { stage } = harness(PORTRAIT, { layout: 'grid', direction: 'rtl' });
    stage.fitAll();
    const all = stage.visiblePages();
    expect(all.length).toBe(5);
    const p1 = all.find((p) => p.pageIndex === 0)!;
    // page 1 occupies the rightmost cell of the top row
    expect(Math.max(...all.map((p) => p.x))).toBeCloseTo(p1.x, 6);
    expect(Math.min(...all.map((p) => p.y))).toBeCloseTo(p1.y, 6);
  });
});

describe('viewpoint: per-page view memory (construction worksheets)', () => {
  it('goToPage with a saved viewpoint restores the exact camera', () => {
    const { stage } = harness(PORTRAIT, { flow: 'paged' });
    stage.goToPage(2, { behavior: 'instant' });
    stage.zoomAround({ x: 700, y: 500 }, 3); // zoom into "the bathroom"
    stage.panBy(-40, -60);
    const saved = stage.viewpoint();
    const cameraBefore = stage.camera();

    stage.goToPage(0, { behavior: 'instant' }); // go work on another floor
    expect(stage.currentPage()).toBe(0);

    stage.goToPage(2, { behavior: 'instant', viewpoint: saved }); // come back
    expect(stage.currentPage()).toBe(2);
    expect(stage.camera().zoom).toBeCloseTo(cameraBefore.zoom, 4);
    expect(stage.camera().x).toBeCloseTo(cameraBefore.x, 2);
    expect(stage.camera().y).toBeCloseTo(cameraBefore.y, 2);
  });
});
