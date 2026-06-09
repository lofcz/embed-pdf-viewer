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

describe('placeCamera — THE placement algorithm', () => {
  const scene = S.linearLayout(
    [
      { width: 600, height: 800 },
      { width: 600, height: 800 },
      { width: 600, height: 800 },
    ],
    S.groupPages(3, 'none'),
    { axis: 'y', gap: GAP },
  );
  const rect = (i: number) => {
    const it = scene.items[i];
    return { x: it.x, y: it.y, width: it.width, height: it.height };
  };

  it('overflowing subject → start-aligned (top-left, a padding out)', () => {
    // zoom 1: page 600x800 vs viewport 1000x700 → overflows vertically only
    const cam = S.placeCamera(rect(1), vp, 1, 24);
    expect((scene.items[1].y - cam.y) * cam.zoom).toBeCloseTo(24, 6); // top edge a padding down
    // horizontal fits → centered
    expect((scene.items[1].x + 300 - cam.x) * cam.zoom).toBeCloseTo(vp.width / 2, 6);
  });

  it('fitting subject → centered (per axis, derived from the clamp fit-case)', () => {
    // zoom 0.5: page 300x400 vs 1000x700 → fits both axes → centered both axes
    const cam = S.placeCamera(rect(1), vp, 0.5, 24);
    expect((scene.items[1].x + 300 - cam.x) * cam.zoom).toBeCloseTo(vp.width / 2, 6);
    expect((scene.items[1].y + 400 - cam.y) * cam.zoom).toBeCloseTo(vp.height / 2, 6);
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
  const k0 = { bounded: true, padding: 0 } as const;

  it('clamps the camera within the content when bounded', () => {
    const clamped = S.clampCamera(
      { x: 0, y: 99999, zoom: 1 },
      { x: 0, y: 0, width: 1000, height: 5000 },
      vp,
      k0,
    );
    expect(clamped.y).toBeLessThanOrEqual(5000 - vp.height + 0.001);
    expect(clamped.y).toBeGreaterThanOrEqual(0);
  });

  it('passes through untouched when unbounded', () => {
    const c = { x: 0, y: 99999, zoom: 1 };
    expect(
      S.clampCamera(c, { x: 0, y: 0, width: 10, height: 10 }, vp, {
        bounded: false,
        padding: 0,
      }),
    ).toEqual(c);
  });

  it('confines to a NON-zero-origin rect (a single paged item)', () => {
    // an item sitting at world y=4000, height 800, viewport 700 tall (item taller than vp)
    const bounds = { x: 0, y: 4000, width: 1000, height: 800 };
    const top = S.clampCamera({ x: 0, y: -99999, zoom: 1 }, bounds, vp, k0);
    expect(top.y).toBeCloseTo(4000, 6); // can't scroll above the item's top
    const bottom = S.clampCamera({ x: 0, y: 99999, zoom: 1 }, bounds, vp, k0);
    expect(bottom.y).toBeCloseTo(4000 + 800 - vp.height, 6); // nor below its bottom
  });

  it('centers a small item within its rect (fit-case respects origin)', () => {
    // item smaller than the viewport ⇒ centered around bounds.y, not 0
    const bounds = { x: 0, y: 4000, width: 300, height: 300 };
    const c = S.clampCamera({ x: 0, y: 0, zoom: 1 }, bounds, vp, k0);
    expect(c.y).toBeCloseTo(4000 + (300 - vp.height) / 2, 6); // centered within the item's rect
  });

  it('padding = a constant breathing gutter the camera may reveal', () => {
    const p = 24;
    const k = { bounded: true, padding: p } as const;
    const bounds = { x: 0, y: 0, width: 1000, height: 5000 };
    // may scroll up to `padding` beyond each content edge…
    const top = S.clampCamera({ x: 0, y: -99999, zoom: 1 }, bounds, vp, k);
    expect(top.y).toBeCloseTo(-p, 6);
    const bottom = S.clampCamera({ x: 0, y: 99999, zoom: 1 }, bounds, vp, k);
    expect(bottom.y).toBeCloseTo(5000 - vp.height + p, 6);
    // …and at exactly fit-width zoom, the lock leaves exactly `padding` per side.
    const zFit = (vp.width - 2 * p) / 1000;
    const fit = S.clampCamera({ x: -99999, y: 0, zoom: zFit }, bounds, vp, k);
    expect(fit.x * zFit).toBeCloseTo(-p, 4); // padding of gutter on the left
  });
});

describe('resolveZoom: fit-all', () => {
  it('fits the whole scene box (same math as fit-page, whole-scene box)', () => {
    const sceneBox = { width: 3000, height: 2400 };
    expect(S.resolveZoom({ mode: S.ZoomMode.FitAll }, sceneBox, vp, GAP)).toBeCloseTo(
      Math.min((1000 - 2 * GAP) / 3000, (700 - 2 * GAP) / 2400),
      6,
    );
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
