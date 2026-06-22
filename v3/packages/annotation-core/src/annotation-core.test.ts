import { describe, expect, it } from 'vitest';
import { initialModel, update } from './update';
import { chrome, pageItems } from './view';
import { cursorAt } from './hit';
import {
  geomBounds,
  geomHit,
  geomScene,
  geomVisualBounds,
  contentToPdfRect,
  pdfToContentRect,
  contentToPdfPoint,
  pdfToContentPoint,
} from './geometry';
import { cloudyBorderExtent } from './cloudy';
import type { Annot, Geom, Model, Msg } from './types';

const PON = 1 as Annot['pon'];
const editPtr = (phase: 'down' | 'move' | 'up', x: number, y: number, shift = false): Msg => ({
  t: 'editPointer',
  phase,
  in: { pon: PON, point: { x, y }, shift },
});
const createPtr = (
  subtype: 'square' | 'circle' | 'line',
  phase: 'down' | 'move' | 'up',
  x: number,
  y: number,
): Msg => ({ t: 'createPointer', phase, subtype, in: { pon: PON, point: { x, y }, shift: false } });
const run = (m: Model, msgs: Msg[]): Model => msgs.reduce((acc, msg) => update(acc, msg)[0], m);
const rectGeom = (g: Geom) => (g.t === 'rect' ? g.rect : null);

describe('annotation-core', () => {
  it('creates square / circle / line with the right geom + a create effect', () => {
    const sq = run(initialModel, [
      createPtr('square', 'down', 100, 100),
      createPtr('square', 'move', 200, 160),
      createPtr('square', 'up', 200, 160),
    ]);
    const a = sq.byId[sq.order[0]];
    expect(a.geom).toMatchObject({ t: 'rect', ellipse: false });
    expect(rectGeom(a.geom)).toMatchObject({ x: 100, y: 100, width: 100, height: 60 });
    expect(a.source).toBe('vector');

    const ci = run(initialModel, [
      createPtr('circle', 'down', 0, 0),
      createPtr('circle', 'move', 50, 50),
      createPtr('circle', 'up', 50, 50),
    ]);
    expect(ci.byId[ci.order[0]].geom).toMatchObject({ t: 'rect', ellipse: true });

    const ln = run(initialModel, [
      createPtr('line', 'down', 10, 10),
      createPtr('line', 'move', 90, 40),
      createPtr('line', 'up', 90, 40),
    ]);
    expect(ln.byId[ln.order[0]].geom).toMatchObject({
      t: 'line',
      a: { x: 10, y: 10 },
      b: { x: 90, y: 40 },
    });

    const [, fx] = update(
      run(initialModel, [createPtr('square', 'down', 0, 0), createPtr('square', 'move', 40, 40)]),
      createPtr('square', 'up', 40, 40),
    );
    expect(fx[0]).toMatchObject({ fx: 'create' });
  });

  it('an UNFILLED rect is hit only on its stroke; a filled one anywhere inside', () => {
    const r: Geom = {
      t: 'rect',
      rect: { x: 100, y: 100, width: 100, height: 100 },
      ellipse: false,
    };
    expect(geomHit(r, { x: 150, y: 150 }, 4, /* filled */ false, 2)).toBe(false); // centre, unfilled → miss
    expect(geomHit(r, { x: 100, y: 150 }, 4, false, 2)).toBe(true); // on the left edge → hit
    expect(geomHit(r, { x: 150, y: 150 }, 4, /* filled */ true, 2)).toBe(true); // filled → centre hits
  });

  it('an UNFILLED circle is hit only near its outline', () => {
    const c: Geom = { t: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, ellipse: true };
    expect(geomHit(c, { x: 50, y: 50 }, 4, false, 2)).toBe(false); // centre → miss
    expect(geomHit(c, { x: 100, y: 50 }, 4, false, 2)).toBe(true); // right vertex of the ellipse → hit
  });

  it('selection is sticky: a SELECTED annotation moves from anywhere in its bounds', () => {
    let m = run(initialModel, [
      createPtr('square', 'down', 100, 100),
      createPtr('square', 'move', 200, 200),
      createPtr('square', 'up', 200, 200),
    ]);
    const id = m.order[0]; // selected after create; unfilled
    // centre is inside bounds → since it's selected, a drag from the centre moves it
    m = run(m, [editPtr('down', 150, 150), editPtr('move', 180, 170), editPtr('up', 180, 170)]);
    expect(rectGeom(m.byId[id].geom)).toMatchObject({ x: 130, y: 120 });
  });

  it('deselect clears the selection (click on empty)', () => {
    let m = run(initialModel, [
      createPtr('square', 'down', 100, 100),
      createPtr('square', 'move', 200, 160),
      createPtr('square', 'up', 200, 160),
    ]);
    expect(m.selected).toHaveLength(1);
    m = update(m, { t: 'deselect' })[0];
    expect(m.selected).toHaveLength(0);
  });

  it('resize from the SE handle keeps the NW corner', () => {
    let m = run(initialModel, [
      createPtr('square', 'down', 100, 100),
      createPtr('square', 'move', 200, 200),
      createPtr('square', 'up', 200, 200),
    ]);
    const id = m.order[0]; // SE handle at (200,200)
    m = run(m, [editPtr('down', 200, 200), editPtr('move', 260, 240), editPtr('up', 260, 240)]);
    expect(rectGeom(m.byId[id].geom)).toMatchObject({ x: 100, y: 100, width: 160, height: 140 });
  });

  it('cursorAt: resize cursor on a handle, move over a selected body', () => {
    const m = run(initialModel, [
      createPtr('square', 'down', 100, 100),
      createPtr('square', 'move', 200, 200),
      createPtr('square', 'up', 200, 200),
    ]);
    expect(cursorAt(m, PON, { x: 200, y: 200 }, 6, 6)).toBe('nwse-resize'); // SE handle
    expect(cursorAt(m, PON, { x: 150, y: 150 }, 6, 6)).toBe('move'); // selected body
    expect(cursorAt(m, PON, { x: 600, y: 600 }, 6, 6)).toBeNull(); // empty
  });

  it('view: a single selection emits 8 handles (carrying cursors)', () => {
    const m = run(initialModel, [
      createPtr('square', 'down', 100, 100),
      createPtr('square', 'move', 200, 180),
      createPtr('square', 'up', 200, 180),
    ]);
    expect(pageItems(m, PON)).toHaveLength(1);
    const c = chrome(m, PON);
    expect(c.filter((n) => n.kind === 'handle')).toHaveLength(8);
    expect(c.find((n) => n.kind === 'handle' && (n as { cursor: string }).cursor)).toBeTruthy();
  });

  it('pageItems hands the renderer the endings-aware box (geomVisualBounds), not the tight bounds', () => {
    const line: Annot = {
      id: 'L1',
      ref: null,
      pon: PON,
      subtype: 'line',
      geom: {
        t: 'line',
        a: { x: 10, y: 10 },
        b: { x: 90, y: 10 },
        ends: { start: 'none', end: 'closed-arrow' },
      },
      style: {
        strokeColor: '#000000',
        fillColor: '#ff0000',
        strokeWidth: 3,
        opacity: 1,
        border: { kind: 'solid' },
      },
      locked: false,
      source: 'vector',
    };
    const m = update(initialModel, { t: 'loaded', annots: [line] })[0];
    const it = pageItems(m, PON)[0];
    // the render box IS the same calculation that feeds the engine /Rect…
    expect(it.box).toEqual(geomVisualBounds(it.geom, it.style.strokeWidth));
    // …and it encloses the arrowhead + stroke, so it is strictly larger than the
    // tight geometry bounds (the cause of the old clipped/misplaced endings).
    const tight = geomBounds(it.geom);
    expect(it.box.width).toBeGreaterThan(tight.width);
    expect(it.box.height).toBeGreaterThan(tight.height);
  });

  it('the selection outline wraps the line endings; shape outlines stay tight (handles on the box)', () => {
    const line: Annot = {
      id: 'L1',
      ref: null,
      pon: PON,
      subtype: 'line',
      geom: {
        t: 'line',
        a: { x: 60, y: 75 },
        b: { x: 545, y: 235 },
        ends: { start: 'none', end: 'open-arrow' },
      },
      style: {
        strokeColor: '#000000',
        fillColor: null,
        strokeWidth: 8,
        opacity: 1,
        border: { kind: 'solid' },
      },
      locked: false,
      source: 'vector',
    };
    const m = update(initialModel, { t: 'loaded', annots: [line] })[0];
    const sel = update(m, editPtr('down', 60, 75))[0]; // select the line
    const outlineRect = (mm: Model) => {
      const n = chrome(mm, PON).find((x) => x.kind === 'outline');
      return n && n.kind === 'outline' ? n.rect : null;
    };
    const lineOutline = outlineRect(sel)!;
    const tight = geomBounds(sel.byId['L1'].geom);
    expect(lineOutline).toEqual(geomVisualBounds(sel.byId['L1'].geom, 8));
    expect(lineOutline.width).toBeGreaterThan(tight.width);
    expect(lineOutline.height).toBeGreaterThan(tight.height);

    // a square: outline stays tight, so its 8 handles land on the outline corners
    const sq = run(initialModel, [
      createPtr('square', 'down', 100, 100),
      createPtr('square', 'move', 200, 200),
      createPtr('square', 'up', 200, 200),
    ]);
    expect(outlineRect(sq)).toMatchObject({ x: 100, y: 100, width: 100, height: 100 });
  });

  it('the arrowhead is clickable, not just the stroke', () => {
    const g: Geom = {
      t: 'line',
      a: { x: 60, y: 75 },
      b: { x: 545, y: 235 },
      ends: { start: 'none', end: 'open-arrow' },
    };
    const sw = 8;
    const onArrow = { x: 510, y: 242 }; // on the lower wing, ~19px off the a→b stroke band
    expect(geomHit(g, onArrow, 6, /* filled */ false, sw)).toBe(true);
    // the hit comes from the ENDING, not the line: with no endings that point misses
    const noEnds: Geom = { t: 'line', a: g.a, b: g.b };
    expect(geomHit(noEnds, onArrow, 6, false, sw)).toBe(false);
    // and a point off both the line and the arrowhead still misses
    expect(geomHit(g, { x: 300, y: 360 }, 6, false, sw)).toBe(false);
  });

  it('geomScene fills by closed-ness: closed arrow → closed poly, open arrow → open poly', () => {
    const line = (end: 'closed-arrow' | 'open-arrow'): Geom => ({
      t: 'line',
      a: { x: 0, y: 0 },
      b: { x: 100, y: 0 },
      ends: { start: 'none', end },
    });
    const closed = geomScene(line('closed-arrow'), 2);
    expect(closed.some((n) => n.kind === 'poly' && n.closed)).toBe(true); // filled head
    const open = geomScene(line('open-arrow'), 2);
    expect(open.some((n) => n.kind === 'poly' && !n.closed)).toBe(true); // stroke-only head
    expect(open.some((n) => n.kind === 'poly' && n.closed)).toBe(false);
  });

  it('PDF↔content round-trips through a non-zero crop', () => {
    const crop = { left: 10, bottom: 20, right: 600, top: 800 };
    const pdf = { left: 100, bottom: 300, right: 250, top: 420 };
    expect(contentToPdfRect(pdfToContentRect(pdf, crop), crop)).toMatchObject(pdf);
    const pt = { x: 123, y: 456 };
    expect(contentToPdfPoint(pdfToContentPoint(pt, crop), crop)).toMatchObject(pt);
  });

  it('a shape rect is its OUTER box: visual bounds equal the box, the drawn path insets by half the stroke', () => {
    const g: Geom = { t: 'rect', rect: { x: 100, y: 100, width: 80, height: 60 }, ellipse: false };
    // the box never grows with the stroke — the stroke lives inside it
    expect(geomVisualBounds(g, 20)).toEqual(g.rect);
    const [node] = geomScene(g, 20);
    expect(node).toMatchObject({ kind: 'rect', rect: { x: 110, y: 110, width: 60, height: 40 } });
  });

  it('hit-testing follows the inset stroke: a thick stroke is clickable on its inner edge, the phantom band outside the box shrinks', () => {
    const g: Geom = {
      t: 'rect',
      rect: { x: 100, y: 100, width: 100, height: 100 },
      ellipse: false,
    };
    const sw = 24;
    const margin = 4;
    // the stroke is drawn inside the box, centred ~12px in; its inner edge must hit
    expect(geomHit(g, { x: 122, y: 150 }, margin, false, sw)).toBe(true);
    // a point well outside the box (past the margin) must miss — no phantom band
    // where the stroke used to straddle the edge
    expect(geomHit(g, { x: 90, y: 150 }, margin, false, sw)).toBe(false);
    // and the box edge itself is still on the (outer half of the) stroke → hits
    expect(geomHit(g, { x: 100, y: 150 }, margin, false, sw)).toBe(true);
  });

  it('a cloudy border emits one closed path whose scallops stay within the box (no spill past /Rect)', () => {
    const box = { x: 100, y: 100, width: 120, height: 90 };
    const g: Geom = { t: 'rect', rect: box, ellipse: false };
    const [node] = geomScene(g, 2, { kind: 'cloudy', intensity: 2 });
    expect(node.kind).toBe('path');
    const d = node.kind === 'path' ? node.d : '';
    // pull every coordinate out of the path data and confirm it's inside the box
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    const eps = 0.5;
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(box.x - eps);
    expect(Math.max(...xs)).toBeLessThanOrEqual(box.x + box.width + eps);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(box.y - eps);
    expect(Math.max(...ys)).toBeLessThanOrEqual(box.y + box.height + eps);
  });

  it('cloudyBorderExtent grows with intensity and stroke; circle scallops are larger than square', () => {
    expect(cloudyBorderExtent(2, 4, false)).toBeGreaterThan(cloudyBorderExtent(1, 4, false));
    expect(cloudyBorderExtent(1, 10, false)).toBeGreaterThan(cloudyBorderExtent(1, 4, false));
    expect(cloudyBorderExtent(1, 4, true)).toBeGreaterThan(cloudyBorderExtent(1, 4, false));
  });
});
