import { describe, expect, it } from 'vitest';
import { makePageContext } from '../src/runtime';

/**
 * The rotation/scale math is exhaustively covered in @embedpdf-x/geometry. Here
 * we only verify the adapter WIRING: `makePageContext` feeds the DOM rect's
 * center + the content size + scale into `screenToPagePoint`. One un-rotated
 * non-unit-scale case and one quarter-turn case are enough to catch a wiring
 * regression (e.g. passing the wrong rect corner, or dropping `rotation`).
 */
describe('makePageContext.toPagePoint wiring', () => {
  function rectAt(left: number, top: number, w: number, h: number): () => DOMRect {
    return () =>
      ({
        left,
        top,
        right: left + w,
        bottom: top + h,
        width: w,
        height: h,
        x: left,
        y: top,
        toJSON() {},
      }) as DOMRect;
  }

  it('un-rotated, scale 2: classic (clientX − left) / scale', () => {
    // surface at (10,20), content 200×300 screen px → AABB == content frame
    const ctx = makePageContext(
      'd',
      1,
      0,
      2,
      { width: 200, height: 300 },
      rectAt(10, 20, 200, 300),
      0,
    );
    expect(ctx.toPagePoint(10, 20)).toEqual({ x: 0, y: 0 }); // top-left → origin
    expect(ctx.toPagePoint(110, 170)).toEqual({ x: 50, y: 75 }); // center → size/2/scale
  });

  it('90°, scale 2: inverts the wrapper rotation (content top-left ⇒ box top-right)', () => {
    // content 200×300 screen px; rotated 90° the wrapper's AABB is 300×200.
    // Center it at (160, 220): AABB left=10, top=120.
    const ctx = makePageContext(
      'd',
      1,
      0,
      2,
      { width: 200, height: 300 },
      rectAt(10, 120, 300, 200),
      90,
    );
    // content (0,0) appears at the box top-right; round-trips back to (0,0)
    const back = ctx.toPagePoint(310, 120); // box top-right corner on screen
    expect(back.x).toBeCloseTo(0, 4);
    expect(back.y).toBeCloseTo(0, 4);
  });

  it('carries the chrome frame for the pageChrome slot to size bands', () => {
    const frame = { top: 0, right: 0, bottom: 16, left: 0 };
    const ctx = makePageContext(
      'd',
      1,
      0,
      1,
      { width: 110, height: 150 },
      rectAt(0, 0, 110, 150),
      0,
      frame,
    );
    expect(ctx.frame).toEqual(frame);
    // defaults to no frame when omitted
    expect(
      makePageContext('d', 1, 0, 1, { width: 1, height: 1 }, rectAt(0, 0, 1, 1)).frame,
    ).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});
