import { describe, expect, it } from 'vitest';
import { initialModel, update } from './update';
import { chrome, pageItems } from './view';
import { cursorAt, hitTest } from './hit';
import { capsFor } from './kinds';
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
import { scene } from './scene';
import type { Annot, Geom, Model, Msg, RenderItem } from './types';

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

  it('capabilities are orthogonal, not one binary: shapes resize, lines vertex-edit, markup neither', () => {
    expect(capsFor('square')).toMatchObject({
      selectable: true,
      movable: true,
      resizable: true,
      vertexEditable: false,
    });
    expect(capsFor('line')).toMatchObject({
      selectable: true,
      movable: true,
      resizable: false,
      vertexEditable: true,
    });
    expect(capsFor('polygon')).toMatchObject({ selectable: true, vertexEditable: true });
    // markup is selectable but ANCHORED — recolor/delete, never move/resize.
    expect(capsFor('highlight')).toMatchObject({
      selectable: true,
      anchored: true,
      movable: false,
      resizable: false,
      vertexEditable: false,
    });
    expect(capsFor('totally-unknown').selectable).toBe(false); // unknown → read-only
  });

  it('a markup preview renders as a live ghost via pageItems, and clears', () => {
    const m = update(initialModel, {
      t: 'setMarkupPreview',
      subtype: 'highlight',
      rectsByPage: { [PON]: [{ x: 10, y: 10, width: 80, height: 12 }] },
    })[0];
    const ghost = pageItems(m, PON).find((i) => i.source === 'ghost');
    expect(ghost?.subtype).toBe('highlight');
    expect(ghost?.geom.t).toBe('quads');
    const cleared = update(m, { t: 'clearMarkupPreview' })[0];
    expect(pageItems(cleared, PON).some((i) => i.source === 'ghost')).toBe(false);
  });

  it('scene() paints markup per subtype in the core (no framework logic): highlight fills+multiply, squiggly strokes a path', () => {
    const quads: Geom = {
      t: 'quads',
      quads: [
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 0, y: 12 },
          { x: 100, y: 12 },
        ],
      ],
    };
    const mk = (subtype: string): RenderItem => ({
      id: 'x',
      ref: null,
      subtype,
      geom: quads,
      box: { x: 0, y: 0, width: 100, height: 12 },
      style: {
        strokeColor: '#ffd400',
        fillColor: '#ffd400',
        strokeWidth: 0,
        opacity: 1,
        border: { kind: 'solid' },
      },
      source: 'vector',
      selected: false,
    });
    const hi = scene(mk('highlight'));
    expect(hi[0]).toMatchObject({ kind: 'rect', paint: { fill: '#ffd400', blend: 'multiply' } });
    const sq = scene(mk('squiggly'));
    expect(sq[0].kind).toBe('path');
    expect(sq[0].paint.stroke).toBe('#ffd400');
    expect(sq[0].paint.fill).toBeUndefined(); // stroke-only, no fill
  });

  it('scene() paints a shape uniformly: a closed node carries fill + stroke + width', () => {
    const item: RenderItem = {
      id: 's',
      ref: null,
      subtype: 'square',
      geom: { t: 'rect', rect: { x: 0, y: 0, width: 50, height: 40 }, ellipse: false },
      box: { x: 0, y: 0, width: 50, height: 40 },
      style: {
        strokeColor: '#000000',
        fillColor: '#eeeeee',
        strokeWidth: 3,
        opacity: 1,
        border: { kind: 'solid' },
      },
      source: 'vector',
      selected: false,
    };
    expect(scene(item)[0]).toMatchObject({
      kind: 'rect',
      paint: { fill: '#eeeeee', stroke: '#000000', width: 3 },
    });
    expect(scene(item)[0].paint.cap).toBeUndefined(); // shapes stay sharp (only ink rounds)
  });

  it('freehand creates an ink annotation from a pointer drag; scene paints it stroke-only', () => {
    const ink = (phase: 'down' | 'move' | 'up', x: number, y: number): Msg => ({
      t: 'createPointer',
      phase,
      subtype: 'ink',
      in: { pon: PON, point: { x, y }, shift: false },
    });
    const m = run(initialModel, [
      ink('down', 10, 10),
      ink('move', 25, 20),
      ink('move', 40, 30),
      ink('up', 40, 30),
    ]);
    const a = m.byId[m.order[0]];
    expect(a.geom).toMatchObject({ t: 'ink' });
    expect(a.geom.t === 'ink' && a.geom.strokes[0].length).toBe(3);
    expect(a.source).toBe('vector');
    // a short tap (no travel) is discarded, not committed
    const tap = run(initialModel, [ink('down', 5, 5), ink('up', 5, 5)]);
    expect(tap.order).toHaveLength(0);
    // scene: each stroke is a stroke-only open polyline, with ROUND caps (pen ends)
    const node = scene(pageItems(m, PON)[0])[0];
    expect(node.kind).toBe('poly');
    expect(node.paint.fill).toBeUndefined();
    expect(node.paint.stroke).toBe(a.style.strokeColor);
    expect(node.paint.cap).toBe('round');
  });

  it('a selected ink wraps its stroke: the outline expands by the stroke, not tight to the centerline', () => {
    const ink: Annot = {
      id: 'I1',
      ref: null,
      pon: PON,
      subtype: 'ink',
      geom: {
        t: 'ink',
        strokes: [
          [
            { x: 20, y: 20 },
            { x: 80, y: 60 },
          ],
        ],
      },
      style: {
        strokeColor: '#1d4ed8',
        fillColor: null,
        strokeWidth: 10,
        opacity: 1,
        border: { kind: 'solid' },
      },
      locked: false,
      source: 'vector',
    };
    let m = update(initialModel, { t: 'loaded', annots: [ink] })[0];
    m = update(m, editPtr('down', 50, 40))[0]; // click on the stroke → selects it
    const outline = chrome(m, PON).find((n) => n.kind === 'outline');
    // tight centerline bounds are 60×40; the stroke (width 10) expands them by 5/side → 70×50
    expect(outline?.kind === 'outline' && outline.rect.width).toBe(70);
    expect(outline?.kind === 'outline' && outline.rect.height).toBe(50);
  });

  it('the draft ghost previews the tool defaults, not the bare base style', () => {
    let m = update(initialModel, {
      t: 'setDefaults',
      subtype: 'square',
      patch: { style: { strokeColor: '#123456' } },
    })[0];
    // mid-draw (down + move, no up yet) → the ghost is live
    m = run(m, [createPtr('square', 'down', 10, 10), createPtr('square', 'move', 60, 60)]);
    const ghost = pageItems(m, PON).find((i) => i.source === 'ghost');
    expect(ghost?.style.strokeColor).toBe('#123456'); // tool default, not initialStyle red
  });

  it('restyling a selection updates the annotation but never the base default', () => {
    let m = run(initialModel, [
      createPtr('square', 'down', 10, 10),
      createPtr('square', 'move', 60, 60),
      createPtr('square', 'up', 60, 60),
    ]);
    const baseBefore = m.style.strokeColor;
    m = update(m, { t: 'setStyle', patch: { strokeColor: '#00ff00' } })[0];
    expect(m.byId[m.order[0]].style.strokeColor).toBe('#00ff00'); // the selected square changed
    expect(m.style.strokeColor).toBe(baseBefore); // …the base/default is untouched
  });

  it('markup is selectable but anchored: it selects, shows a bare outline (no handles), and will not move', () => {
    const hl: Annot = {
      id: 'H1',
      ref: null,
      pon: PON,
      subtype: 'highlight',
      geom: {
        t: 'quads',
        quads: [
          [
            { x: 10, y: 10 },
            { x: 90, y: 10 },
            { x: 10, y: 30 },
            { x: 90, y: 30 },
          ],
        ],
      },
      style: {
        strokeColor: '#ffcc00',
        fillColor: '#ffcc00',
        strokeWidth: 0,
        opacity: 1,
        border: { kind: 'solid' },
      },
      locked: false,
      source: 'baked',
    };
    const m0 = update(initialModel, { t: 'loaded', annots: [hl] })[0];
    // clicking the markup selects it…
    expect(hitTest(m0, PON, { x: 50, y: 20 }, 6, 6)).toEqual({ t: 'annot', id: 'H1' });
    const m1 = update(m0, editPtr('down', 50, 20))[0];
    expect(m1.selected).toEqual(['H1']);
    // …but no move gesture is armed (anchored), and chrome is a bare outline.
    expect(m1.draft).toBeNull();
    const c = chrome(m1, PON);
    expect(c.filter((n) => n.kind === 'handle')).toHaveLength(0);
    expect(c.some((n) => n.kind === 'outline')).toBe(true);
  });
});
