import { describe, expect, it } from 'vitest';
import type { PluginContext } from '@embedpdf-x/kernel';
import { createStageCapability } from '../src/capability';
import { initialStageState, stageReducer } from '../src/reducer';
import { stagePlugin } from '../src/stage.plugin';
import type { StageAction, StageConfig, StageState } from '../src/types';

/**
 * Kernel-free harness: drive the real capability against the real reducer + real
 * stage-core, with a fake document and an injectable scheduler. No DOM, no async —
 * the whole Stage is deterministically testable because the core is pure.
 */
function harness(
  sizes: Array<{ width: number; height: number }>,
  config: StageConfig = {},
  opts: { skipViewport?: boolean } = {},
) {
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
  // Mirror the real lifecycle: the shell reports the viewport — initial placement
  // is level-triggered inside setViewport (no manual placeInitial; that's the fix
  // for the "page stuck at top-left until the first scroll" race).
  if (!opts.skipViewport) stage.setViewport({ width: 1000, height: 700 });
  return { stage };
}

const PORTRAIT = Array.from({ length: 5 }, () => ({ width: 600, height: 800 }));
const PAD = 24; // default StageSettings.padding — the fit inset + arrival gutter

describe('initial placement is level-triggered (the new-pane / HMR race)', () => {
  it('places the moment the viewport is reported — no effect/watch involved', () => {
    // The bug: placement hung off an edge-triggered width watch registered during
    // openDocument; if the viewport was already sized first, the edge never came and
    // the camera stayed at {0,0,1} (page flush top-left, no padding) until a scroll.
    const { stage } = harness(PORTRAIT); // harness never calls placeInitial
    const cam = stage.camera();
    expect(cam).not.toEqual({ x: 0, y: 0, zoom: 1 }); // NOT the untouched camera
    // page 1 is properly placed: horizontally centered, top a padding down
    const box = stage.pageRect(1)!;
    const center = stage.toScreen({ x: box.x + box.width / 2, y: box.y });
    expect(center.x).toBeCloseTo(500, 0);
    expect(center.y).toBeCloseTo(PAD, 0);
  });

  it('a half-laid-out viewport (height 0) does not place; the real one does', () => {
    const { stage } = harness(PORTRAIT, undefined, { skipViewport: true });
    stage.setViewport({ width: 1000, height: 0 }); // mid-layout flex collapse
    expect(stage.camera()).toEqual({ x: 0, y: 0, zoom: 1 }); // not placed yet
    stage.setViewport({ width: 1000, height: 700 }); // the real report
    expect(stage.camera()).not.toEqual({ x: 0, y: 0, zoom: 1 }); // placed now
    expect(stage.toScreen({ x: stage.pageRect(1)!.x, y: stage.pageRect(1)!.y }).y).toBeCloseTo(
      PAD,
      0,
    );
  });

  it('initial-view providers (persist) still win over the default placement', () => {
    const { stage } = harness(PORTRAIT, undefined, { skipViewport: true });
    // a persist-like provider registers BEFORE the first viewport report (as in
    // openDocument: effects run synchronously; the report is a later macrotask)
    stage.provideInitialView(50, () => ({
      ...stage.settings(),
      cursor: 3,
      anchor: { pageIndex: 3, fx: 0.5, fy: 0.5 },
    }));
    stage.setViewport({ width: 1000, height: 700 });
    expect(stage.currentPage()).toBe(3); // restored, not reset to page 0
  });
});

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

describe("columns: 'auto' — the wrapped grid (thumbnail sidebar)", () => {
  // fixed zoom 0.2, padding 10, gap 12 → cell 612 world; line = (vpW - 20) / 0.2
  const THUMBS = {
    layout: 'grid' as const,
    columns: 'auto' as const,
    zoom: { level: 0.2 },
    padding: 10,
    gap: 12,
  };

  it('narrow viewport → one column; wider → re-wraps to more', () => {
    const { stage } = harness(PORTRAIT, THUMBS, { skipViewport: true });
    stage.setViewport({ width: 160, height: 700 }); // line = 700 world → 1 column
    expect(stage.pageRect(2)!.x).toBeCloseTo(stage.pageRect(1)!.x, 6); // stacked
    expect(stage.pageRect(2)!.y).toBeGreaterThan(stage.pageRect(1)!.y);

    stage.setViewport({ width: 270, height: 700 }); // line = 1250 → 2 columns
    expect(stage.pageRect(2)!.y).toBeCloseTo(stage.pageRect(1)!.y, 6); // side by side
    expect(stage.pageRect(3)!.y).toBeGreaterThan(stage.pageRect(1)!.y); // row 2

    stage.setViewport({ width: 400, height: 700 }); // line = 1900 → 3 columns
    expect(stage.pageRect(3)!.y).toBeCloseTo(stage.pageRect(1)!.y, 6);
  });

  it('re-wrapping keeps the current page (anchor-preserving resize)', () => {
    const { stage } = harness(PORTRAIT, THUMBS, { skipViewport: true });
    stage.setViewport({ width: 160, height: 400 });
    stage.goToPage(4, { behavior: 'instant' });
    stage.setViewport({ width: 400, height: 400 }); // 1 → 3 columns
    expect(stage.currentPage()).toBe(4);
  });
});

describe('wrapped + discrete zoom: the scene re-wraps and the camera follows', () => {
  // vp 1000, padding 24 → line = 952/zoom; cell = 600 + gap 16 = 616 world.
  // zoom 0.35 → line 2720 → 4 columns; ×1.2 → 0.42 → line 2266 → 3 columns.
  const WRAPPED = {
    layout: 'grid' as const,
    columns: 'auto' as const,
    zoom: { level: 0.35 },
    padding: 24,
    gap: 16,
  };

  it('zoomIn across a column boundary leaves the camera ALREADY clamped (the bug)', () => {
    const { stage } = harness(PORTRAIT, WRAPPED);
    // 4 columns: page 4 (idx 3) sits in row 0
    expect(stage.pageRect(4)!.y).toBeCloseTo(stage.pageRect(1)!.y, 6);
    stage.zoomIn();
    // re-wrapped to 3 columns: page 4 moved to row 1
    expect(stage.pageRect(4)!.y).toBeGreaterThan(stage.pageRect(1)!.y);
    // the camera must satisfy the NEW scene's clamp immediately — a no-op pan
    // (which clamps) must not move it. Before the fix, this is where it jumped.
    const settled = stage.camera();
    stage.panBy(0, 0);
    expect(stage.camera()).toEqual(settled);
  });

  it('zoom MODE changes (fit-width/automatic) settle the wrap in one pass (the bug)', () => {
    const { stage } = harness(PORTRAIT, WRAPPED); // level 0.35 → 4 columns
    stage.goToPage(2, { behavior: 'instant' });
    stage.fitWidth(); // resolves to ~1.59 → re-wraps to a single column
    expect(stage.currentPage()).toBe(2); // the reapply never touches the cursor
    expect(stage.pageRect(2)!.y).toBeGreaterThan(stage.pageRect(1)!.y); // 1 column now
    // the camera must already satisfy the NEW scene's clamp — a no-op pan (which
    // clamps) must not move it. Before the fix this is where it jumped on scroll.
    const settled = stage.camera();
    stage.panBy(0, 0);
    expect(stage.camera()).toEqual(settled);
  });

  it('fit-all + wrapped converges too (the circular case, via reapply)', () => {
    const { stage } = harness(PORTRAIT, WRAPPED);
    stage.fitAll(); // zoom depends on scene size, scene size depends on zoom
    const settled = stage.camera();
    stage.panBy(0, 0);
    expect(stage.camera()).toEqual(settled); // legal against the scene it shows
  });

  it('the focal page-point stays under the cursor across the re-wrap (unbounded)', () => {
    // unbounded (the canvas/construction case): no clamp interference, so the
    // re-pin property is exact on both axes. Under bounds, the clamp wins wherever
    // the camera has no freedom — covered by the no-op-pan test above.
    const { stage } = harness(PORTRAIT, { ...WRAPPED, bounded: false });
    const before = stage.pageRect(2)!;
    const screenPt = stage.toScreen({
      x: before.x + before.width * 0.25,
      y: before.y + before.height * 0.4,
    });
    stage.zoomAround(screenPt, 1.2); // crosses the 4→3 column boundary
    const after = stage.pageRect(2)!; // page 2 has MOVED in the new wrap…
    const world = stage.toWorld(screenPt); // …but its page-point is back under the cursor
    expect((world.x - after.x) / after.width).toBeCloseTo(0.25, 3);
    expect((world.y - after.y) / after.height).toBeCloseTo(0.4, 3);
  });

  it('non-wrapped zoomAround is byte-identical (the scene reference never changes)', () => {
    const { stage } = harness(PORTRAIT, { bounded: false }); // unbounded: pure focal, no clamp
    const screenPt = { x: 300, y: 200 };
    const worldBefore = stage.toWorld(screenPt);
    stage.zoomAround(screenPt, 1.7);
    const worldAfter = stage.toWorld(screenPt);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 4); // pure focal zoom, no drift
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 4);
  });
});

describe('the stage is a LENS: multiple instances per document', () => {
  it('stagePlugin({id, token}) registers an independent instance', () => {
    const ThumbsToken = { name: 'stage-thumbs-test' };
    const main = stagePlugin();
    const thumbs = stagePlugin({
      id: 'stage-thumbs',
      token: ThumbsToken as never,
      layout: 'grid',
      columns: 'auto',
      zoom: { level: 0.2 },
    });
    expect(main.id).toBe('stage');
    expect(thumbs.id).toBe('stage-thumbs');
    expect(thumbs.token).toBe(ThumbsToken);
    // each lens gets its own initial settings…
    const mainState = (main.initialState as () => StageState)();
    const thumbState = (thumbs.initialState as () => StageState)();
    expect(mainState.layout).toBe('vertical');
    expect(thumbState.layout).toBe('grid');
    expect(thumbState.columns).toBe('auto');
    // …and id/token do NOT leak into the settings state
    expect('id' in thumbState).toBe(false);
    expect('token' in thumbState).toBe(false);
  });

  it('two lenses over the same document hold independent cameras', () => {
    // two capabilities with separate slices over the SAME document metadata —
    // exactly what the kernel does for two registered stage plugins.
    const { stage: main } = harness(PORTRAIT);
    const { stage: thumbs } = harness(PORTRAIT, {
      layout: 'grid',
      columns: 'auto',
      zoom: { level: 0.2 },
    });
    main.goToPage(4, { behavior: 'instant' });
    expect(main.currentPage()).toBe(4);
    expect(thumbs.currentPage()).toBe(0); // the sidebar lens did not move
    expect(thumbs.zoomLevel()).toBeCloseTo(0.2, 6);
    expect(main.zoomLevel()).not.toBeCloseTo(0.2, 6);
  });
});

describe('zoom { pageWidth }: pixel-target thumbnails for ANY document', () => {
  const MIXED = [
    { width: 600, height: 800 },
    { width: 1000, height: 700 }, // the widest
    { width: 500, height: 900 },
  ];

  it('uniform + pageWidth: EVERY page renders exactly N screen px wide', () => {
    const { stage } = harness(MIXED, { sizing: 'uniform', zoom: { pageWidth: 200 } });
    const zoom = stage.zoomLevel();
    expect(stage.pageRect(1)!.width * zoom).toBeCloseTo(200, 4);
    expect(stage.pageRect(2)!.width * zoom).toBeCloseTo(200, 4);
    expect(stage.pageRect(3)!.width * zoom).toBeCloseTo(200, 4);
  });

  it('the same config gives the same pixels for a totally different document', () => {
    const HUGE = [
      { width: 2880, height: 2000 }, // construction sheets
      { width: 2880, height: 2000 },
    ];
    const { stage } = harness(HUGE, { sizing: 'uniform', zoom: { pageWidth: 200 } });
    expect(stage.pageRect(1)!.width * stage.zoomLevel()).toBeCloseTo(200, 4);
  });

  it('intrinsic + pageWidth: the WIDEST page is N px, narrower ones proportional', () => {
    const { stage } = harness(MIXED, { zoom: { pageWidth: 200 } }); // sizing intrinsic
    const zoom = stage.zoomLevel();
    expect(stage.pageRect(2)!.width * zoom).toBeCloseTo(200, 4); // widest = 200
    expect(stage.pageRect(1)!.width * zoom).toBeCloseTo(120, 4); // 600/1000 of it
    expect(stage.pageRect(3)!.width * zoom).toBeCloseTo(100, 4);
  });

  it('paged + pageWidth: the CURRENT page is N px (per-page exact)', () => {
    const { stage } = harness(MIXED, { flow: 'paged', zoom: { pageWidth: 200 } });
    expect(stage.pageRect(1)!.width * stage.zoomLevel()).toBeCloseTo(200, 4);
    stage.goToPage(1, { behavior: 'instant' }); // the 1000-wide page
    expect(stage.pageRect(2)!.width * stage.zoomLevel()).toBeCloseTo(200, 4);
  });

  it('wrapped + pageWidth converges (the thumbnail-sidebar config)', () => {
    const { stage } = harness(MIXED, {
      layout: 'grid',
      columns: 'auto',
      sizing: 'uniform',
      zoom: { pageWidth: 200 },
      padding: 10,
      gap: 12,
    });
    expect(stage.pageRect(1)!.width * stage.zoomLevel()).toBeCloseTo(200, 4);
    const settled = stage.camera();
    stage.panBy(0, 0); // a no-op pan clamps — the camera must already be legal
    expect(stage.camera()).toEqual(settled);
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
