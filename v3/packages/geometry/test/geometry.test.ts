import { describe, expect, it } from 'vitest';
import {
  displaySize,
  rotateInBox,
  screenToPagePoint,
  unrotateInBox,
  type PageRotation,
  type Point,
  type Size,
} from '../src/index';

const ROTATIONS: PageRotation[] = [0, 90, 180, 270];

describe('displaySize: w↔h swap for quarter-turns', () => {
  it('swaps for 90/270, keeps for 0/180', () => {
    const c: Size = { width: 600, height: 800 };
    expect(displaySize(c, 0)).toEqual({ width: 600, height: 800 });
    expect(displaySize(c, 90)).toEqual({ width: 800, height: 600 });
    expect(displaySize(c, 180)).toEqual({ width: 600, height: 800 });
    expect(displaySize(c, 270)).toEqual({ width: 800, height: 600 });
  });
});

describe('rotateInBox / unrotateInBox are exact inverses', () => {
  const content: Size = { width: 600, height: 800 };
  for (const rotation of ROTATIONS) {
    it(`round-trips at ${rotation}°`, () => {
      for (const p of [
        { x: 0, y: 0 },
        { x: 600, y: 800 },
        { x: 137, y: 211 },
        { x: 600, y: 0 },
        { x: 0, y: 800 },
      ]) {
        const box = rotateInBox(p, content, rotation);
        const back = unrotateInBox(box, content, rotation);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    });
  }

  it('90°: content top-left lands at the display box top-right', () => {
    // box for a 600×800 page rotated 90° is 800×600
    expect(rotateInBox({ x: 0, y: 0 }, { width: 600, height: 800 }, 90)).toEqual({ x: 800, y: 0 });
    // content bottom-left → box top-left
    expect(rotateInBox({ x: 0, y: 800 }, { width: 600, height: 800 }, 90)).toEqual({ x: 0, y: 0 });
  });
});

/**
 * screenToPagePoint must invert the forward projection at ANY zoom (the bug
 * that motivated this package: the content size was double-scaled, so it only
 * worked at scale === 1).
 */
describe('screenToPagePoint: inverse of projection at any rotation × scale', () => {
  const center: Point = { x: 137, y: 211 };
  const contentSize: Size = { width: 240, height: 360 }; // un-rotated footprint, screen px

  function project(px: number, py: number, scale: number, rotation: PageRotation): Point {
    // page point → display-box offset (content offset, rotated), then to screen
    const boxOffset = rotateInBox({ x: px * scale, y: py * scale }, contentSize, rotation);
    const display = displaySize(contentSize, rotation);
    return {
      x: center.x - display.width / 2 + boxOffset.x,
      y: center.y - display.height / 2 + boxOffset.y,
    };
  }

  for (const rotation of ROTATIONS) {
    for (const scale of [1, 2, 0.5, 1.37]) {
      it(`round-trips at rotation ${rotation}, scale ${scale}`, () => {
        for (const [px, py] of [
          [0, 0],
          [contentSize.width / scale, contentSize.height / scale],
          [50, 75],
          [120, 30],
        ]) {
          const screen = project(px, py, scale, rotation);
          const back = screenToPagePoint({ screen, center, contentSize, scale, rotation });
          expect(back.x).toBeCloseTo(px, 4);
          expect(back.y).toBeCloseTo(py, 4);
        }
      });
    }
  }
});
