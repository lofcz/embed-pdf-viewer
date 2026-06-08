import { describe, expect, it } from 'vitest';
import * as S from '../src';

const vp = { width: 1000, height: 700 };
const GAP = 16;

describe('resolveZoom', () => {
  it('fit-width fits the box width (minus gap)', () => {
    expect(
      S.resolveZoom({ mode: S.ZoomMode.FitWidth }, { width: 2000, height: 800 }, vp, GAP),
    ).toBeCloseTo((1000 - 2 * GAP) / 2000, 6);
  });

  it('fit-page fits the smaller of width/height', () => {
    expect(
      S.resolveZoom({ mode: S.ZoomMode.FitPage }, { width: 2000, height: 3000 }, vp, GAP),
    ).toBeCloseTo(Math.min((1000 - 2 * GAP) / 2000, (700 - 2 * GAP) / 3000), 6);
  });

  it('automatic = fit-width but capped at 100% (height-independent)', () => {
    // narrow box → fit-width would upscale → capped to 1
    expect(
      S.resolveZoom({ mode: S.ZoomMode.Automatic }, { width: 400, height: 800 }, vp, GAP),
    ).toBe(1);
    // wide box → below 100% → fits width
    expect(
      S.resolveZoom({ mode: S.ZoomMode.Automatic }, { width: 2000, height: 800 }, vp, GAP),
    ).toBeCloseTo((1000 - 2 * GAP) / 2000, 6);
    // a tall page does NOT zoom out — automatic ignores height
    expect(
      S.resolveZoom({ mode: S.ZoomMode.Automatic }, { width: 400, height: 5000 }, vp, GAP),
    ).toBe(1);
  });

  it('a fixed level passes through, clamped to [ZOOM_MIN, ZOOM_MAX]', () => {
    expect(S.resolveZoom({ level: 2.5 }, { width: 1, height: 1 }, vp)).toBe(2.5);
    expect(S.resolveZoom({ level: 999 }, { width: 1, height: 1 }, vp)).toBe(S.ZOOM_MAX);
    expect(S.resolveZoom({ level: 0 }, { width: 1, height: 1 }, vp)).toBe(S.ZOOM_MIN);
  });
});

describe('itemCamera', () => {
  const scene = S.linearLayout(
    [
      { width: 600, height: 800 },
      { width: 600, height: 800 },
      { width: 600, height: 800 },
    ],
    S.groupPages(3, 'none'),
    { axis: 'y', gap: GAP },
  );

  it("'start' puts the page top a margin below the viewport top (scroll-to-top)", () => {
    const item = scene.items[1];
    const cam = S.itemCamera(item, scene, vp, 1, { align: 'start', margin: 24 });
    // the page's top edge, in screen space, equals the margin
    expect((item.y - cam.y) * cam.zoom).toBeCloseTo(24, 6);
  });

  it("'center' centres the page in the viewport", () => {
    const item = scene.items[1];
    const cam = S.itemCamera(item, scene, vp, 1, { align: 'center' });
    expect((item.y + item.height / 2 - cam.y) * cam.zoom).toBeCloseTo(vp.height / 2, 6);
  });
});

describe('zoomAround', () => {
  it('keeps the world point under the cursor fixed (no drift)', () => {
    const c = { x: 100, y: 50, zoom: 1 };
    const cursor = { x: 300, y: 200 };
    const before = S.toWorld(c, cursor);
    const after = S.toWorld(S.zoomAround(c, cursor, 2.3), cursor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe('anchor round-trip', () => {
  it('cameraFromAnchor inverts anchorFromCamera', () => {
    const scene = S.linearLayout(
      [
        { width: 600, height: 800 },
        { width: 600, height: 800 },
        { width: 600, height: 800 },
      ],
      S.groupPages(3, 'none'),
      { axis: 'y', gap: GAP },
    );
    const cam = { x: scene.items[1].x, y: scene.items[1].y + 120, zoom: 1.3 };
    const anchor = S.anchorFromCamera(cam, scene, vp);
    const back = S.cameraFromAnchor(anchor, scene, vp, 1.3);
    expect(back.x).toBeCloseTo(cam.x, 4);
    expect(back.y).toBeCloseTo(cam.y, 4);
  });
});

describe('clampCamera', () => {
  it('clamps the camera within the content when bounded', () => {
    const clamped = S.clampCamera({ x: 0, y: 99999, zoom: 1 }, { width: 1000, height: 5000 }, vp, {
      bounded: true,
      overscroll: { x: 0, y: 0 },
    });
    expect(clamped.y).toBeLessThanOrEqual(5000 - vp.height + 0.001);
  });

  it('passes through untouched when unbounded', () => {
    const c = { x: 0, y: 99999, zoom: 1 };
    expect(
      S.clampCamera(c, { width: 10, height: 10 }, vp, {
        bounded: false,
        overscroll: { x: 0, y: 0 },
      }),
    ).toEqual(c);
  });
});

describe('layout maxItemSize', () => {
  it('linearLayout reports the max item width & height across mixed pages', () => {
    const scene = S.linearLayout(
      [
        { width: 600, height: 800 },
        { width: 900, height: 700 },
        { width: 600, height: 1200 },
      ],
      S.groupPages(3, 'none'),
      { axis: 'y', gap: GAP },
    );
    expect(scene.maxItemSize).toEqual({ width: 900, height: 1200 });
  });

  it('gridLayout reports the cell max as max item size', () => {
    const scene = S.gridLayout(
      [
        { width: 600, height: 800 },
        { width: 900, height: 700 },
      ],
      S.groupPages(2, 'none'),
      { gap: 48 },
    );
    expect(scene.maxItemSize).toEqual({ width: 900, height: 800 });
  });
});

describe('sizing: uniform (cross-axis equalize)', () => {
  const mixed = [
    { width: 600, height: 800 }, // portrait
    { width: 1000, height: 700 }, // widest
    { width: 500, height: 900 }, // narrow + tallest
  ];

  it('vertical uniform makes every item width equal (to the widest) + records contentScale', () => {
    const scene = S.linearLayout(mixed, S.groupPages(3, 'none'), {
      axis: 'y',
      gap: GAP,
      sizing: 'uniform',
    });
    expect(scene.items.every((it) => Math.abs(it.width - 1000) < 1e-6)).toBe(true);
    expect(scene.items[1].pages[0].contentScale).toBeCloseTo(1, 6); // widest → factor 1
    expect(scene.items[0].pages[0].contentScale).toBeCloseTo(1000 / 600, 6);
    expect(scene.items[2].pages[0].contentScale).toBeCloseTo(1000 / 500, 6);
    expect(scene.items[0].height).toBeCloseTo(800 * (1000 / 600), 6); // height scales too
  });

  it('horizontal uniform makes every item height equal (to the tallest)', () => {
    const scene = S.linearLayout(mixed, S.groupPages(3, 'none'), {
      axis: 'x',
      gap: GAP,
      sizing: 'uniform',
    });
    expect(scene.items.every((it) => Math.abs(it.height - 900) < 1e-6)).toBe(true);
    expect(scene.items[2].pages[0].contentScale).toBeCloseTo(1, 6); // tallest → factor 1
    expect(scene.items[0].pages[0].contentScale).toBeCloseTo(900 / 800, 6);
  });

  it('intrinsic keeps true sizes (contentScale 1)', () => {
    const scene = S.linearLayout(mixed, S.groupPages(3, 'none'), {
      axis: 'y',
      gap: GAP,
      sizing: 'intrinsic',
    });
    expect(scene.items.map((it) => it.width)).toEqual([600, 1000, 500]);
    expect(scene.items.every((it) => it.pages[0].contentScale === 1)).toBe(true);
  });
});

describe('groupPages', () => {
  it('groups by spread mode', () => {
    expect(S.groupPages(4, 'none')).toEqual([[0], [1], [2], [3]]);
    expect(S.groupPages(4, 'odd')).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(S.groupPages(4, 'even')).toEqual([[0], [1, 2], [3]]);
  });
});
