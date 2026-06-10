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

  it('pageWidth/pageHeight: absolute pixel targets, document-independent', () => {
    // a 612pt letter and a 2880pt construction sheet both render 200px wide
    expect(612 * S.resolveZoom({ pageWidth: 200 }, { width: 612, height: 792 }, vp)).toBeCloseTo(
      200,
      6,
    );
    expect(2880 * S.resolveZoom({ pageWidth: 200 }, { width: 2880, height: 2000 }, vp)).toBeCloseTo(
      200,
      6,
    );
    // vertical twin (filmstrip): box height = N px
    expect(792 * S.resolveZoom({ pageHeight: 150 }, { width: 612, height: 792 }, vp)).toBeCloseTo(
      150,
      6,
    );
    // clamped like every other intent
    expect(S.resolveZoom({ pageWidth: 1 }, { width: 1e9, height: 1 }, vp)).toBe(S.ZOOM_MIN);
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

  it("alignment picks a point in the clamp range: 'end' = top-right (RTL)", () => {
    // zoom 2: page 1200x1600 overflows both axes
    const r = rect(1);
    const cam = S.placeCamera(r, vp, 2, 24, { x: 'end', y: 'start' });
    // right edge of the page sits a padding in from the viewport's right edge
    expect((r.x + r.width - cam.x) * cam.zoom).toBeCloseTo(vp.width - 24, 6);
    // top edge a padding down (reading starts at the top)
    expect((r.y - cam.y) * cam.zoom).toBeCloseTo(24, 6);
  });

  it("alignment 'center' centers an overflowing page (Drawboard feel)", () => {
    const r = rect(1);
    const cam = S.placeCamera(r, vp, 2, 24, { x: 'center', y: 'center' });
    expect((r.x + r.width / 2 - cam.x) * cam.zoom).toBeCloseTo(vp.width / 2, 6);
    expect((r.y + r.height / 2 - cam.y) * cam.zoom).toBeCloseTo(vp.height / 2, 6);
  });

  it('alignment is irrelevant when the axis FITS (min = mid = max)', () => {
    const r = rect(1);
    const a = S.placeCamera(r, vp, 0.5, 24, { x: 'start', y: 'start' });
    const b = S.placeCamera(r, vp, 0.5, 24, { x: 'end', y: 'end' });
    const c = S.placeCamera(r, vp, 0.5, 24, { x: 'center', y: 'center' });
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});

describe('revealCamera — scrollIntoView as camera math', () => {
  const rect = { x: 100, y: 2000, width: 300, height: 400 };

  it('already fully visible → the camera is unchanged (no-op by construction)', () => {
    const cam = { x: 0, y: 1900, zoom: 1 }; // window [1900..2600] contains [2000..2400]
    expect(S.revealCamera(cam, rect, vp, 24)).toEqual(cam);
  });

  it('target below → MINIMAL scroll: far edge lands a padding inside', () => {
    const cam = { x: 0, y: 0, zoom: 1 }; // rect is far below the window
    const out = S.revealCamera(cam, rect, vp, 24);
    expect(out.y).toBeCloseTo(2000 + 400 - (700 - 24), 6); // bottom edge + padding
    expect(out.x).toBe(0); // x already fine → untouched (per-axis independence)
  });

  it('target above → minimal scroll the other way: near edge + padding', () => {
    const cam = { x: 0, y: 5000, zoom: 1 };
    expect(S.revealCamera(cam, rect, vp, 24).y).toBeCloseTo(2000 - 24, 6);
  });

  it('oversized target → aligns its start (like scrollIntoView)', () => {
    const big = { x: 0, y: 2000, width: 300, height: 5000 };
    expect(S.revealCamera({ x: 0, y: 0, zoom: 1 }, big, vp, 24).y).toBeCloseTo(2000 - 24, 6);
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

describe('direction: rtl (a layout property, not a navigation one)', () => {
  const four = Array.from({ length: 4 }, () => ({ width: 600, height: 800 }));

  it('horizontal rtl: page 1 sits at the RIGHT, items advance leftward', () => {
    const scene = S.linearLayout(four, S.groupPages(4, 'none'), {
      axis: 'x',
      gap: GAP,
      direction: 'rtl',
    });
    // item 0 is the rightmost, item 3 the leftmost
    expect(scene.items[0].x).toBeCloseTo(scene.size.width - 600, 6);
    expect(scene.items[3].x).toBeCloseTo(0, 6);
    // the spatial index still works on the mirrored geometry
    const found = scene.query({ x: 0, y: 0, width: 10, height: 800 });
    expect(found.some((it) => it.index === 3)).toBe(true);
    expect(scene.nearestItem({ x: scene.size.width - 5, y: 400 }).index).toBe(0);
  });

  it('vertical rtl: scroll axis unchanged, but SPREADS bind on the right', () => {
    const scene = S.linearLayout(four, S.groupPages(4, 'odd'), {
      axis: 'y',
      gap: GAP,
      direction: 'rtl',
    });
    expect(scene.items[0].y).toBe(0); // still top-down
    const [p0, p1] = scene.items[0].pages;
    // reading-first page (0) takes the RIGHT slot of the spread
    expect(p0.pageIndex).toBe(0);
    expect(p0.x).toBeGreaterThan(p1.x);
  });

  it('grid rtl: rows fill right→left, top→bottom; index lookups still O(1)', () => {
    const scene = S.gridLayout(four, S.groupPages(4, 'none'), {
      gap: 48,
      columns: 2,
      direction: 'rtl',
    });
    // row 0: item 0 right, item 1 left; row 1 below
    expect(scene.items[0].x).toBeGreaterThan(scene.items[1].x);
    expect(scene.items[2].y).toBeGreaterThan(scene.items[0].y);
    expect(scene.items[2].x).toBeGreaterThan(scene.items[3].x);
    // nearestItem maps spatial columns back to reading order
    expect(scene.nearestItem({ x: scene.size.width - 5, y: 5 }).index).toBe(0);
    expect(scene.nearestItem({ x: 5, y: 5 }).index).toBe(1);
  });

  it('placeCamera: align.x is LOGICAL — start lands at the RIGHT edge in rtl', () => {
    const subject = { x: 0, y: 0, width: 1200, height: 1600 }; // overflows at zoom 1
    const cam = S.placeCamera(subject, vp, 1, 24, { x: 'start', y: 'start' }, 'rtl');
    // reading start = right edge: subject's right sits a padding in from viewport right
    expect((subject.width - cam.x) * cam.zoom).toBeCloseTo(vp.width - 24, 6);
    expect((0 - cam.y) * cam.zoom).toBeCloseTo(24, 6); // top unchanged
  });
});

describe('pageMargin: reserved chrome space around each PAGE', () => {
  const P = { width: 600, height: 800 };
  const m = { top: 10, right: 8, bottom: 20, left: 6 };

  it('linear vertical: pages sit inside their slots; bands reserved between pages', () => {
    const scene = S.linearLayout([P, P], S.groupPages(2, 'none'), {
      axis: 'y',
      gap: 16,
      pageMargin: m,
    });
    const p0 = scene.items[0].pages[0];
    const p1 = scene.items[1].pages[0];
    expect(p0.x - scene.items[0].x).toBeCloseTo(6, 6); // left band inside the item
    expect(p0.y - scene.items[0].y).toBeCloseTo(10, 6); // top band
    // page-bottom → next page-top = bottom + gap + top (the chrome never collides)
    expect(p1.y - (p0.y + p0.height)).toBeCloseTo(20 + 16 + 10, 6);
    expect(scene.items[0].height).toBeCloseTo(800 + 30, 6); // outer box
  });

  it('SPREADS: each page keeps its OWN flanks — left/right chrome works (the fix)', () => {
    const scene = S.linearLayout([P, P], S.groupPages(2, 'odd'), {
      axis: 'y',
      gap: 16,
      pageMargin: m,
    });
    const [a, b] = scene.items[0].pages;
    // between the spread halves: a's right band + gap + b's left band
    expect(b.x - (a.x + a.width)).toBeCloseTo(8 + 16 + 6, 6);
    expect(a.x - scene.items[0].x).toBeCloseTo(6, 6); // outer flank too
  });

  it('RTL spread: slots mirror but margins stay PHYSICAL (left room stays mL)', () => {
    const scene = S.linearLayout([P, P], S.groupPages(2, 'odd'), {
      axis: 'y',
      gap: 16,
      pageMargin: m,
      direction: 'rtl',
    });
    const item = scene.items[0];
    const left = item.pages.find((p) => p.pageIndex === 1)!; // reading-second sits left
    const right = item.pages.find((p) => p.pageIndex === 0)!;
    expect(left.x - item.x).toBeCloseTo(6, 6); // mL preserved at the item edge
    expect(right.x - (left.x + left.width)).toBeCloseTo(8 + 16 + 6, 6);
  });

  it('uniform sizing scales the PAGES, never the margins', () => {
    const scene = S.linearLayout(
      [
        { width: 600, height: 800 },
        { width: 1200, height: 800 },
      ],
      S.groupPages(2, 'none'),
      { axis: 'y', gap: 16, sizing: 'uniform', pageMargin: m },
    );
    // page 1 scaled up to 1200 wide; both outer widths equal 1200 + 14
    expect(scene.items[0].pages[0].width).toBeCloseTo(1200, 6);
    expect(scene.items[0].width).toBeCloseTo(1200 + 14, 6);
    expect(scene.items[1].width).toBeCloseTo(1200 + 14, 6);
    expect(scene.items[0].pages[0].x - scene.items[0].x).toBeCloseTo(6, 6); // margin constant
  });
});

describe('gridLayout per-row heights (mixed page sizes)', () => {
  it('a row is as tall as ITS tallest item, not the global max (no giant voids)', () => {
    const pages = [
      { width: 600, height: 800 }, // row 0
      { width: 600, height: 400 }, // row 0 (short — centers within ROW height)
      { width: 600, height: 1200 }, // row 1 (the global max)
      { width: 600, height: 600 }, // row 1
    ];
    const scene = S.gridLayout(pages, S.groupPages(4, 'none'), { gap: 12, columns: 2 });
    // row 0 is 800 tall (NOT 1200): row 1 starts right below it + gap
    expect(scene.items[2].y).toBeCloseTo(800 + 12, 6);
    // the short page centers within its OWN row's height
    expect(scene.items[1].y).toBeCloseTo((800 - 400) / 2, 6);
    expect(scene.items[3].y).toBeCloseTo(800 + 12 + (1200 - 600) / 2, 6);
    // scene height = sum of row heights + gap, not rows × global max
    expect(scene.size.height).toBeCloseTo(800 + 12 + 1200, 6);
    // the spatial index respects the variable rows
    expect(scene.nearestItem({ x: 300, y: 850 }).index).toBe(2);
    const hits = scene.query({ x: 0, y: 0, width: 1212, height: 700 });
    expect(hits.map((it) => it.index).sort()).toEqual([0, 1]);
  });
});

describe('gridLayout lineWidth (wrapped)', () => {
  const pages = Array.from({ length: 7 }, () => ({ width: 600, height: 800 }));
  const g = () => S.groupPages(7, 'none');
  // cell = 600 wide, gap 48 → a column costs 648 of (lineWidth + 48)

  it('derives the column count from the line width', () => {
    expect(S.gridLayout(pages, g(), { gap: 48, lineWidth: 1300 }).items[1].y).toBe(0); // 2 cols: item 1 in row 0
    const two = S.gridLayout(pages, g(), { gap: 48, lineWidth: 1300 });
    expect(two.items[2].y).toBeGreaterThan(0); // …and item 2 wrapped to row 1
    const three = S.gridLayout(pages, g(), { gap: 48, lineWidth: 2000 });
    expect(three.items[2].y).toBe(0); // 3 columns now
    expect(three.items[3].y).toBeGreaterThan(0);
  });

  it('never fewer than 1 column, never more than the item count', () => {
    const narrow = S.gridLayout(pages, g(), { gap: 48, lineWidth: 100 });
    expect(narrow.items.every((it, i) => i === 0 || it.y > narrow.items[i - 1].y)).toBe(true); // 1 col
    const wide = S.gridLayout(pages.slice(0, 3), S.groupPages(3, 'none'), {
      gap: 48,
      lineWidth: 99999,
    });
    expect(wide.size.width).toBeCloseTo(3 * 648 - 48, 6); // clamped to 3 occupied columns
  });

  it('wrapped + RTL fills each derived row right→left', () => {
    const scene = S.gridLayout(pages, g(), { gap: 48, lineWidth: 1300, direction: 'rtl' });
    expect(scene.items[0].x).toBeGreaterThan(scene.items[1].x); // row 0: 0 right of 1
    expect(scene.items[2].y).toBeGreaterThan(scene.items[0].y); // row 1 below
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
