import { describe, expect, it } from 'vitest';
import { initialModel, update } from './update';
import {
  chrome,
  creationDraftAnchor,
  pageItems,
  selectionAnchor,
  selectionBoundsOnPage,
  selectionKnob,
} from './view';
import { cursorAt, groupUnionBounds, hitTest } from './hit';
import { capsFor } from './kinds';
import {
  geomBounds,
  geomHit,
  geomScene,
  geomVisualBounds,
  geomHandles,
  geomTranslate,
  geomDragHandle,
  calloutConnection,
  calloutLinePoints,
  selectionBounds,
  shapeRectFor,
  caretRectFromTextEnd,
  contentToPdfRect,
  pdfToContentRect,
  contentToPdfPoint,
  pdfToContentPoint,
  centroidOf,
  geomRotation,
  geomRotateAbout,
  geomResetRotation,
  obbFromGeom,
  rotatedAabb,
  normalizeDeg,
  selectionQuad,
  selectionCenter,
} from './geometry';
import { cloudyBorderExtent } from './cloudy';
import { scene } from './scene';
import { expandGroups, groupKeyOf, groupMembers } from './group';
import type { Annot, Geom, Model, Msg, RenderItem, Style, Subtype, Vec } from './types';

const PON = 1 as Annot['pon'];
const editPtr = (phase: 'down' | 'move' | 'up', x: number, y: number, shift = false): Msg => ({
  t: 'editPointer',
  phase,
  in: { pon: PON, point: { x, y }, shift },
});
const marqueePtr = (phase: 'down' | 'move' | 'up', x: number, y: number, shift = false): Msg => ({
  t: 'marqueePointer',
  phase,
  in: { pon: PON, point: { x, y }, shift },
});
const createPtr = (
  subtype: Extract<Subtype, 'square' | 'circle' | 'line' | 'polygon' | 'polyline'> | 'free-text',
  phase: 'down' | 'move' | 'up',
  x: number,
  y: number,
  finish = false,
): Msg => ({
  t: 'createPointer',
  phase,
  subtype,
  in: { pon: PON, point: { x, y }, shift: false, finish },
});
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

  it('creates polygon and polyline from clicked vertices, finishing on an explicit final click', () => {
    const polygon = run(initialModel, [
      createPtr('polygon', 'down', 10, 10),
      createPtr('polygon', 'up', 10, 10),
      createPtr('polygon', 'down', 80, 10),
      createPtr('polygon', 'up', 80, 10),
      createPtr('polygon', 'down', 40, 70),
      createPtr('polygon', 'up', 40, 70),
      createPtr('polygon', 'down', 40, 70, true),
    ]);
    const pg = polygon.byId[polygon.order[0]];
    expect(pg.geom).toEqual({
      t: 'poly',
      points: [
        { x: 10, y: 10 },
        { x: 80, y: 10 },
        { x: 40, y: 70 },
      ],
      closed: true,
      ends: undefined,
    });
    expect(pg.source).toBe('vector');
    expect(polygon.selected).toEqual([pg.id]);

    const polyline = run(initialModel, [
      createPtr('polyline', 'down', 20, 20),
      createPtr('polyline', 'up', 20, 20),
      createPtr('polyline', 'down', 90, 45),
      createPtr('polyline', 'up', 90, 45),
      createPtr('polyline', 'down', 90, 45, true),
    ]);
    const pl = polyline.byId[polyline.order[0]];
    expect(pl.geom).toEqual({
      t: 'poly',
      points: [
        { x: 20, y: 20 },
        { x: 90, y: 45 },
      ],
      closed: false,
      ends: { start: 'none', end: 'none' },
    });
  });

  it('previews an in-progress polygon with the hover point but commits only clicked vertices', () => {
    const drawing = run(initialModel, [
      createPtr('polygon', 'down', 10, 10),
      createPtr('polygon', 'down', 80, 10),
      createPtr('polygon', 'move', 40, 70),
    ]);
    const ghost = pageItems(drawing, PON).find((i) => i.source === 'ghost');
    expect(ghost?.geom).toEqual({
      t: 'poly',
      points: [
        { x: 10, y: 10 },
        { x: 80, y: 10 },
        { x: 40, y: 70 },
      ],
      closed: true,
      ends: undefined,
    });

    const committed = run(drawing, [
      createPtr('polygon', 'down', 80, 80),
      createPtr('polygon', 'down', 80, 80, true),
    ]);
    const geom = committed.byId[committed.order[0]].geom;
    expect(geom.t === 'poly' && geom.points).toEqual([
      { x: 10, y: 10 },
      { x: 80, y: 10 },
      { x: 80, y: 80 },
    ]);
  });

  it('exposes a committed-bounds rect anchor for finishing or cancelling an active poly creation draft', () => {
    let m = run(initialModel, [
      createPtr('polygon', 'down', 10, 10),
      createPtr('polygon', 'down', 80, 10),
    ]);
    expect(creationDraftAnchor(m)).toMatchObject({
      kind: 'poly',
      subtype: 'polygon',
      pon: PON,
      bounds: { x: 10, y: 10, width: 70, height: 0 },
      pointCount: 2,
      minPoints: 3,
      canFinish: false,
    });

    m = run(m, [createPtr('polygon', 'down', 40, 70)]);
    expect(creationDraftAnchor(m)).toMatchObject({
      bounds: { x: 10, y: 10, width: 70, height: 60 },
      pointCount: 3,
      canFinish: true,
    });

    m = update(m, { t: 'finishCreationDraft' })[0];
    expect(m.draft).toBeNull();
    expect(m.order).toHaveLength(1);
    expect(m.byId[m.order[0]].geom).toMatchObject({ t: 'poly', closed: true });
    expect(creationDraftAnchor(m)).toBeNull();
  });

  it('creates a caret at the end of a text line rect', () => {
    const lineRect = { x: 20, y: 40, width: 80, height: 20 };
    expect(caretRectFromTextEnd(lineRect)).toEqual({ x: 95, y: 50, width: 10, height: 10 });

    const [m, fx] = update(initialModel, { t: 'createCaret', pon: PON, rect: lineRect });
    const a = m.byId[m.order[0]];
    expect(a).toMatchObject({
      subtype: 'caret',
      geom: { t: 'caret', rect: { x: 95, y: 50, width: 10, height: 10 } },
      source: 'vector',
    });
    expect(m.selected).toEqual([a.id]);
    expect(fx[0]).toMatchObject({ fx: 'create', id: a.id });
    expect(scene(pageItems(m, PON)[0])[0]).toMatchObject({
      kind: 'path',
      paint: { fill: initialModel.style.color, stroke: initialModel.style.color },
    });
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

  it('a selected arrow is grabbable anywhere inside its outline box, not just on the thin stroke', () => {
    const arrow: Annot = {
      id: 'A1',
      ref: null,
      pon: PON,
      subtype: 'line',
      geom: {
        t: 'line',
        a: { x: 100, y: 100 },
        b: { x: 300, y: 200 },
        ends: { start: 'none', end: 'closed-arrow' },
      },
      style: {
        color: '#000000',
        interiorColor: null,
        strokeWidth: 6,
        opacity: 1,
        border: { kind: 'solid' },
      },
      locked: false,
      source: 'vector',
    };
    const corner = { x: 290, y: 110 }; // inside the bbox, far from the diagonal stroke
    let m = update(initialModel, { t: 'loaded', annots: [arrow] })[0];
    // UNSELECTED → only the painted region (stroke + arrowhead) hits; the corner misses
    expect(hitTest(m, PON, corner, 6, 6).t).toBe('empty');
    // select it (click on the stroke at its midpoint)…
    m = run(m, [editPtr('down', 200, 150), editPtr('up', 200, 150)]);
    expect(m.selected).toEqual(['A1']);
    // …now the whole selection outline is grabbable — the grab area == the outline
    expect(hitTest(m, PON, corner, 6, 6)).toEqual({ t: 'annot', id: 'A1' });
    expect(selectionBounds(arrow.geom, 6)).toEqual(geomVisualBounds(arrow.geom, 6)); // line: outline == visual bounds
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

  it('marquee selects selectable annotations intersecting the dragged box', () => {
    let m = run(initialModel, [
      createPtr('square', 'down', 10, 10),
      createPtr('square', 'move', 60, 60),
      createPtr('square', 'up', 60, 60),
      createPtr('circle', 'down', 120, 120),
      createPtr('circle', 'move', 160, 160),
      createPtr('circle', 'up', 160, 160),
      createPtr('square', 'down', 300, 300),
      createPtr('square', 'move', 340, 340),
      createPtr('square', 'up', 340, 340),
    ]);

    m = run(m, [
      marqueePtr('down', 0, 0),
      marqueePtr('move', 180, 180),
      marqueePtr('up', 180, 180),
    ]);

    expect(m.selected).toEqual([m.order[0], m.order[1]]);
    expect(m.draft).toBeNull();
  });

  it('shift-marquee toggles hits against the current selection', () => {
    let m = run(initialModel, [
      createPtr('square', 'down', 10, 10),
      createPtr('square', 'move', 60, 60),
      createPtr('square', 'up', 60, 60),
      createPtr('circle', 'down', 120, 120),
      createPtr('circle', 'move', 160, 160),
      createPtr('circle', 'up', 160, 160),
    ]);
    const [a, b] = m.order;
    expect(m.selected).toEqual([b]); // last created annotation stays selected

    m = run(m, [
      marqueePtr('down', 0, 0, true),
      marqueePtr('move', 80, 80, true),
      marqueePtr('up', 80, 80, true),
    ]);

    expect(m.selected).toEqual([b, a]);
  });

  it('marquee ignores locked or otherwise unselectable annotations', () => {
    const locked: Annot = {
      id: 'locked',
      ref: null,
      pon: PON,
      subtype: 'square',
      geom: { t: 'rect', rect: { x: 10, y: 10, width: 50, height: 50 }, ellipse: false },
      style: initialModel.style,
      locked: true,
      source: 'vector',
    };
    let m = update(initialModel, { t: 'loaded', annots: [locked] })[0];

    m = run(m, [marqueePtr('down', 0, 0), marqueePtr('move', 80, 80), marqueePtr('up', 80, 80)]);

    expect(m.selected).toEqual([]);
  });

  it('active marquee draft emits a marquee chrome node', () => {
    const m = run(initialModel, [marqueePtr('down', 10, 20), marqueePtr('move', 40, 60)]);
    expect(chrome(m, PON)).toContainEqual({
      kind: 'marquee',
      rect: { x: 10, y: 20, width: 30, height: 40 },
    });
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
        color: '#000000',
        interiorColor: '#ff0000',
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
        color: '#000000',
        interiorColor: null,
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

  it('a cloudy border insets its scallops within g.rect (the outer box); too-small falls back to a plain outline', () => {
    const box = { x: 100, y: 100, width: 120, height: 90 };
    const g: Geom = { t: 'rect', rect: box, ellipse: false };
    const [node] = geomScene(g, 2, { kind: 'cloudy', intensity: 2 });
    expect(node.kind).toBe('path');
    const d = node.kind === 'path' ? node.d : '';
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    const eps = 0.5;
    // g.rect is the OUTER box; the scallops stay within it (outline is tight, like solid)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(box.x - eps);
    expect(Math.max(...xs)).toBeLessThanOrEqual(box.x + box.width + eps);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(box.y - eps);
    expect(Math.max(...ys)).toBeLessThanOrEqual(box.y + box.height + eps);
    // a box too small to hold the scallops → plain rect node, never an inverted cloud
    const tiny: Geom = { t: 'rect', rect: { x: 0, y: 0, width: 4, height: 4 }, ellipse: false };
    expect(geomScene(tiny, 2, { kind: 'cloudy', intensity: 2 })[0].kind).toBe('rect');
  });

  it('shapeRectFor stores the OUTER box for a cloudy shape (dragged + extent), the dragged box for solid', () => {
    const dragged = { x: 50, y: 50, width: 40, height: 30 };
    const solid: Style = {
      color: '#000000',
      interiorColor: null,
      strokeWidth: 2,
      opacity: 1,
      border: { kind: 'solid' },
    };
    expect(shapeRectFor(dragged, false, solid)).toEqual(dragged);
    const e = cloudyBorderExtent(2, 2, false);
    expect(
      shapeRectFor(dragged, false, { ...solid, border: { kind: 'cloudy', intensity: 2 } }),
    ).toEqual({
      x: 50 - e,
      y: 50 - e,
      width: 40 + 2 * e,
      height: 30 + 2 * e,
    });
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
        color: '#ffd400',
        interiorColor: '#ffd400',
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
        color: '#000000',
        interiorColor: '#eeeeee',
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
    expect(scene(item)[0].paint.join).toBeUndefined(); // solid border → default miter joins
  });

  it('scene() strokes a cloudy border with ROUND joins (PDFium `1 j` parity) — polygon and box alike', () => {
    // The curl tails reverse direction by design; a miter join spikes at every
    // seam. PDFium bakes cloudy APs with `1 j`, so the live paint must match.
    const cloudyStyle = {
      color: '#e5484d',
      interiorColor: null,
      strokeWidth: 4,
      opacity: 1,
      border: { kind: 'cloudy' as const, intensity: 2 },
    };
    const polygon: RenderItem = {
      id: 'p',
      ref: null,
      subtype: 'polygon',
      geom: {
        t: 'poly',
        points: [
          { x: 20, y: 20 },
          { x: 180, y: 40 },
          { x: 100, y: 160 },
        ],
        closed: true,
      },
      box: { x: 0, y: 0, width: 200, height: 180 },
      style: cloudyStyle,
      source: 'vector',
      selected: false,
    };
    const polyNodes = scene(polygon);
    expect(polyNodes).toHaveLength(1); // ONE scalloped ring replaces the plain poly
    expect(polyNodes[0].kind).toBe('path');
    expect(polyNodes[0].paint.join).toBe('round');

    const square: RenderItem = {
      id: 's',
      ref: null,
      subtype: 'square',
      geom: { t: 'rect', rect: { x: 0, y: 0, width: 120, height: 100 }, ellipse: false },
      box: { x: 0, y: 0, width: 120, height: 100 },
      style: cloudyStyle,
      source: 'vector',
      selected: false,
    };
    const sqNodes = scene(square);
    expect(sqNodes[0].kind).toBe('path');
    expect(sqNodes[0].paint.join).toBe('round');
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
    expect(node.paint.stroke).toBe(a.style.color);
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
        color: '#1d4ed8',
        interiorColor: null,
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
      patch: { color: '#123456' },
    })[0];
    // mid-draw (down + move, no up yet) → the ghost is live
    m = run(m, [createPtr('square', 'down', 10, 10), createPtr('square', 'move', 60, 60)]);
    const ghost = pageItems(m, PON).find((i) => i.source === 'ghost');
    expect(ghost?.style.color).toBe('#123456'); // tool default, not initialStyle red
  });

  it('restyling a selection updates the annotation but never the base default', () => {
    let m = run(initialModel, [
      createPtr('square', 'down', 10, 10),
      createPtr('square', 'move', 60, 60),
      createPtr('square', 'up', 60, 60),
    ]);
    const baseBefore = m.style.color;
    m = update(m, { t: 'setProps', patch: { color: '#00ff00' } })[0];
    expect(m.byId[m.order[0]].style.color).toBe('#00ff00'); // the selected square changed
    expect(m.style.color).toBe(baseBefore); // …the base/default is untouched
  });

  it('setProps routes each key by kind: a mixed selection takes what applies', () => {
    // a square + a line, both selected
    let m = run(initialModel, [
      createPtr('square', 'down', 10, 10),
      createPtr('square', 'move', 60, 60),
      createPtr('square', 'up', 60, 60),
      createPtr('line', 'down', 100, 10),
      createPtr('line', 'move', 160, 60),
      createPtr('line', 'up', 160, 60),
    ]);
    const [sq, ln] = m.order;
    m = { ...m, selected: [sq, ln] };
    const [next, fx] = update(m, {
      t: 'setProps',
      patch: { strokeWidth: 7, lineEndings: { end: 'closed-arrow' } },
    });
    // strokeWidth applies to both; endings only to the line (the square ignores it)
    expect(next.byId[sq].style.strokeWidth).toBe(7);
    expect(next.byId[ln].style.strokeWidth).toBe(7);
    const lnGeom = next.byId[ln].geom;
    expect(lnGeom.t === 'line' && lnGeom.ends?.end).toBe('closed-arrow');
    expect(fx).toEqual([
      { fx: 'patch', id: sq },
      { fx: 'patch', id: ln },
    ]);
  });

  it('setProps skips locked annotations and keys the kind does not declare', () => {
    let m = run(initialModel, [
      createPtr('square', 'down', 10, 10),
      createPtr('square', 'move', 60, 60),
      createPtr('square', 'up', 60, 60),
    ]);
    const id = m.order[0];
    m = { ...m, byId: { ...m.byId, [id]: { ...m.byId[id], locked: true } } };
    const [locked, lockedFx] = update(m, { t: 'setProps', patch: { color: '#00ff00' } });
    expect(locked.byId[id].style.color).not.toBe('#00ff00');
    expect(lockedFx).toEqual([]);
    // a font key on a square: not declared → no change, no effect
    m = { ...m, byId: { ...m.byId, [id]: { ...m.byId[id], locked: false } } };
    const [next, fx] = update(m, { t: 'setProps', patch: { fontSize: 24 } });
    expect(next).toBe(m);
    expect(fx).toEqual([]);
  });

  it('a drawn free-text box carries the tool font defaults from birth', () => {
    let m = update(initialModel, {
      t: 'setDefaults',
      subtype: 'free-text',
      patch: { fontSize: 22, fontColor: '#112233' },
    })[0];
    m = run(m, [
      createPtr('free-text', 'down', 10, 10),
      createPtr('free-text', 'up', 10, 10), // a click → default-size box
    ]);
    const a = m.byId[m.order[0]];
    expect(a.text?.fontSize).toBe(22);
    expect(a.text?.fontColor).toBe('#112233');
    // …and setProps edits it (free-text declares font keys)
    const [next] = update(m, { t: 'setProps', patch: { textAlign: 'center' } });
    expect(next.byId[m.order[0]].text?.textAlign).toBe('center');
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
        color: '#ffcc00',
        interiorColor: '#ffcc00',
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

  // ── group annotations ──────────────────────────────────────────────────────
  const sq = (id: string, x: number, group?: string): Annot => ({
    id,
    ref: null,
    pon: PON,
    subtype: 'square',
    geom: { t: 'rect', rect: { x, y: x, width: 40, height: 40 }, ellipse: false },
    style: {
      color: '#000000',
      interiorColor: '#eeeeee', // filled → hittable anywhere inside
      strokeWidth: 2,
      opacity: 1,
      border: { kind: 'solid' },
    },
    locked: false,
    source: 'vector',
    ...(group ? { group } : {}),
  });
  // A group: primary P, plus two subordinates pointing at it via `group: 'P'`.
  const grouped = (): Model =>
    update(initialModel, {
      t: 'loaded',
      annots: [sq('P', 100), sq('C1', 200, 'P'), sq('C2', 300, 'P')],
    })[0];

  it('groupMembers/groupKeyOf resolve a primary and its subordinates from either end', () => {
    const m = grouped();
    // from a subordinate: its `group` field is the key (the primary id)
    expect(groupKeyOf(m, 'C1')).toBe('P');
    // from the primary: it is the target of subordinates → key is its own id
    expect(groupKeyOf(m, 'P')).toBe('P');
    // membership is the same set whichever member you ask about (primary first)
    expect(groupMembers(m, 'C2')).toEqual(['P', 'C1', 'C2']);
    expect(groupMembers(m, 'P')).toEqual(['P', 'C1', 'C2']);
  });

  it('an ungrouped annotation is its own (singleton) group', () => {
    const m = update(initialModel, { t: 'loaded', annots: [sq('S', 10)] })[0];
    expect(groupKeyOf(m, 'S')).toBeNull();
    expect(groupMembers(m, 'S')).toEqual(['S']);
    expect(expandGroups(m, ['S'])).toEqual(['S']);
  });

  it('clicking one member selects the WHOLE group', () => {
    let m = grouped();
    m = update(m, editPtr('down', 215, 215))[0]; // inside C1
    expect(m.selected).toEqual(['P', 'C1', 'C2']);
    // a move gesture is armed across all members (every square is movable)
    expect(m.draft).toMatchObject({ g: 'move', ids: ['P', 'C1', 'C2'] });
  });

  it('dragging one member moves every member of the group together', () => {
    let m = grouped();
    m = run(m, [editPtr('down', 115, 115), editPtr('move', 135, 145), editPtr('up', 135, 145)]);
    // all three translate by the same delta (+20, +30)
    expect(rectGeom(m.byId['P'].geom)).toMatchObject({ x: 120, y: 130 });
    expect(rectGeom(m.byId['C1'].geom)).toMatchObject({ x: 220, y: 230 });
    expect(rectGeom(m.byId['C2'].geom)).toMatchObject({ x: 320, y: 330 });
  });

  it('deleting with a member selected removes the whole group', () => {
    let m = grouped();
    m = update(m, editPtr('down', 215, 215))[0]; // selects the group
    const [next, fx] = update(m, { t: 'delete' });
    expect(next.order).toEqual([]);
    expect(next.selected).toEqual([]);
    // no engine effects here (these fixtures have no refs), but the store is cleared
    expect(fx).toEqual([]);
  });

  it('shift-clicking a member toggles the entire group out of the selection', () => {
    let m = grouped();
    m = update(m, editPtr('down', 215, 215))[0]; // group selected
    expect(m.selected).toEqual(['P', 'C1', 'C2']);
    m = update(m, editPtr('down', 315, 315, /* shift */ true))[0]; // shift-click C2
    expect(m.selected).toEqual([]); // the whole group dropped, not just C2
  });

  it('a marquee that touches one member takes the whole group', () => {
    let m = grouped();
    // box covers only C2 (around x=300..340); P and C1 sit outside it
    m = run(m, [
      marqueePtr('down', 295, 295),
      marqueePtr('move', 345, 345),
      marqueePtr('up', 345, 345),
    ]);
    expect(m.selected).toEqual(['P', 'C1', 'C2']);
  });

  it('the gap inside a selected group is grabbable: a drag there moves every member', () => {
    // P=(100,100), C1=(200,200), C2=(300,300), each 40×40 → (170,170) sits inside
    // the union box but in the empty gap between members (no member covers it).
    let m = grouped();
    m = run(m, [editPtr('down', 215, 215), editPtr('up', 215, 215)]); // select the whole group
    expect(m.selected).toEqual(['P', 'C1', 'C2']);
    // the gap is no longer "empty" — it hits a selected member so the group can drag
    expect(hitTest(m, PON, { x: 170, y: 170 }, 6, 6).t).toBe('annot');
    m = run(m, [editPtr('down', 170, 170), editPtr('move', 190, 200), editPtr('up', 190, 200)]);
    // every member translated by the same delta (+20, +30)
    expect(rectGeom(m.byId['P'].geom)).toMatchObject({ x: 120, y: 130 });
    expect(rectGeom(m.byId['C1'].geom)).toMatchObject({ x: 220, y: 230 });
    expect(rectGeom(m.byId['C2'].geom)).toMatchObject({ x: 320, y: 330 });
  });

  it('the gap inside a multi-selection shows the move cursor; outside the union still clears', () => {
    let m = grouped();
    m = run(m, [editPtr('down', 215, 215), editPtr('up', 215, 215)]); // group selected
    expect(cursorAt(m, PON, { x: 170, y: 170 }, 6, 6)).toBe('move'); // gap → move
    // a click well outside the union box is still empty (so it deselects)
    expect(hitTest(m, PON, { x: 500, y: 500 }, 6, 6).t).toBe('empty');
    expect(cursorAt(m, PON, { x: 500, y: 500 }, 6, 6)).toBeNull();
  });

  it('the union grab needs 2+ movable members: a lone selection leaves its gap empty', () => {
    // a single selected square: a point outside its own bounds is still empty
    // (no union fallback), so single-selection behaviour is unchanged.
    let m = update(initialModel, { t: 'loaded', annots: [sq('S', 100)] })[0];
    m = run(m, [editPtr('down', 115, 115), editPtr('up', 115, 115)]);
    expect(m.selected).toEqual(['S']);
    expect(hitTest(m, PON, { x: 300, y: 300 }, 6, 6).t).toBe('empty');
  });

  it('markups always sit beneath other annotations, regardless of creation order', () => {
    const square: Annot = {
      id: 'S1',
      ref: null,
      pon: PON,
      subtype: 'square',
      geom: { t: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, ellipse: false },
      style: {
        color: '#000000',
        interiorColor: '#eeeeee', // filled → hittable anywhere inside
        strokeWidth: 2,
        opacity: 1,
        border: { kind: 'solid' },
      },
      locked: false,
      source: 'vector',
    };
    const highlight: Annot = {
      id: 'H1',
      ref: null,
      pon: PON,
      subtype: 'highlight',
      geom: {
        t: 'quads',
        quads: [
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 0, y: 100 },
            { x: 100, y: 100 },
          ],
        ],
      },
      style: {
        color: '#ffcc00',
        interiorColor: '#ffcc00',
        strokeWidth: 0,
        opacity: 1,
        border: { kind: 'solid' },
      },
      locked: false,
      source: 'vector',
    };
    // square added FIRST, highlight SECOND — naive creation order would paint the
    // highlight on top.
    const m = update(initialModel, { t: 'loaded', annots: [square, highlight] })[0];
    // pageItems paints back→front: the markup comes first (beneath), the square last (on top).
    expect(pageItems(m, PON).map((i) => i.id)).toEqual(['H1', 'S1']);
    // and the overlap hit-tests to the square (the top-most painted), not the highlight.
    expect(hitTest(m, PON, { x: 50, y: 50 }, 6, 6)).toEqual({ t: 'annot', id: 'S1' });
  });
});

describe('annotation-core callout', () => {
  const calloutPtr = (phase: 'down' | 'move' | 'up', x: number, y: number): Msg => ({
    t: 'createPointer',
    phase,
    subtype: 'free-text-callout',
    in: { pon: PON, point: { x, y }, shift: false },
  });
  // A committed callout geom for the pure-geometry tests: box to the right of an
  // off-box tip, with an elbow between them.
  const calloutGeom = (): Extract<Geom, { t: 'text' }> => ({
    t: 'text',
    rect: { x: 200, y: 100, width: 120, height: 40 },
    callout: { tip: { x: 40, y: 60 }, knee: { x: 120, y: 120 }, ending: 'open-arrow' },
  });

  it('calloutConnection picks the box edge the reference point faces', () => {
    const box = { x: 100, y: 100, width: 100, height: 60 }; // centre (150, 130)
    // ref to the RIGHT (dx dominates, positive) → right-edge midpoint
    expect(calloutConnection(box, { x: 400, y: 130 })).toEqual({ x: 200, y: 130 });
    // ref to the LEFT → left-edge midpoint
    expect(calloutConnection(box, { x: -50, y: 130 })).toEqual({ x: 100, y: 130 });
    // ref ABOVE (dy dominates, negative) → top-edge midpoint
    expect(calloutConnection(box, { x: 150, y: -20 })).toEqual({ x: 150, y: 100 });
    // ref BELOW → bottom-edge midpoint
    expect(calloutConnection(box, { x: 150, y: 300 })).toEqual({ x: 150, y: 160 });
  });

  it('calloutLinePoints is [tip, knee, derived-conn]; conn rides the box, never stored', () => {
    const g = calloutGeom();
    const pts = calloutLinePoints(g);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ x: 40, y: 60 }); // tip
    expect(pts[1]).toEqual({ x: 120, y: 120 }); // knee
    // knee is left of + below the box centre → left-edge midpoint of the box
    expect(pts[2]).toEqual({ x: 200, y: 120 });
  });

  it('geomVisualBounds wraps the box, the leader, AND the arrow at the tip', () => {
    const g = calloutGeom();
    const b = geomVisualBounds(g, 2);
    // the tip (x=40) sits far left of the box (x=200): the overall bounds reach it
    expect(b.x).toBeLessThanOrEqual(40);
    expect(b.y).toBeLessThanOrEqual(60);
    // and still cover the right edge of the box (x=320)
    expect(b.x + b.width).toBeGreaterThanOrEqual(320);
    // a plain text box (no callout) is just its rect
    expect(geomVisualBounds({ t: 'text', rect: { x: 0, y: 0, width: 10, height: 10 } }, 2)).toEqual(
      {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
    );
  });

  it('geomHandles returns the 8 box handles PLUS the leader tip + knee', () => {
    const ids = geomHandles(calloutGeom()).map((h) => h.id);
    expect(ids).toContain('nw');
    expect(ids).toContain('se');
    expect(ids).toContain('callout-tip');
    expect(ids).toContain('callout-knee');
    expect(ids).toHaveLength(10);
    // a knee-less (2-point) callout exposes only the tip
    const noKnee = geomHandles({
      t: 'text',
      rect: { x: 0, y: 0, width: 50, height: 20 },
      callout: { tip: { x: -20, y: 10 }, ending: 'open-arrow' },
    }).map((h) => h.id);
    expect(noKnee).toContain('callout-tip');
    expect(noKnee).not.toContain('callout-knee');
  });

  it('geomTranslate shifts the box, the tip, AND the knee together', () => {
    const g = geomTranslate(calloutGeom(), { x: 10, y: -5 });
    if (g.t !== 'text' || !g.callout) throw new Error('expected callout');
    expect(g.rect).toMatchObject({ x: 210, y: 95 });
    expect(g.callout.tip).toEqual({ x: 50, y: 55 });
    expect(g.callout.knee).toEqual({ x: 130, y: 115 });
  });

  it('geomDragHandle edits the tip / knee / box independently (conn re-derives)', () => {
    const tip = geomDragHandle(calloutGeom(), 'callout-tip', { x: 5, y: 5 });
    expect(tip.t === 'text' && tip.callout?.tip).toEqual({ x: 5, y: 5 });
    const knee = geomDragHandle(calloutGeom(), 'callout-knee', { x: 90, y: 90 });
    expect(knee.t === 'text' && knee.callout?.knee).toEqual({ x: 90, y: 90 });
    // a rect handle resizes the box; the leader's connection point is never stored,
    // so it simply re-derives off the new box on the next read.
    const box = geomDragHandle(calloutGeom(), 'se', { x: 400, y: 300 });
    expect(box.t === 'text' && box.rect).toMatchObject({ x: 200, y: 100, width: 200, height: 200 });
  });

  it('geomScene emits the leader polyline, the arrow node, and a stroke-only box border', () => {
    const nodes = geomScene(calloutGeom(), 1);
    const leader = nodes.find((n) => n.kind === 'poly' && !n.closed);
    expect(leader).toBeDefined();
    // the open leader carries [tip, knee, conn]
    expect(leader && leader.kind === 'poly' && leader.points).toHaveLength(3);
    // a box border rect is present when the stroke is visible
    expect(nodes.some((n) => n.kind === 'rect')).toBe(true);
    // and there is an arrow ending node beyond the bare leader + box
    expect(nodes.length).toBeGreaterThan(2);
    // a plain text box paints nothing
    expect(geomScene({ t: 'text', rect: { x: 0, y: 0, width: 10, height: 10 } }, 1)).toEqual([]);
  });

  it('the 3-click flow (tip → knee → box) commits a callout and opens it for editing', () => {
    let m = run(initialModel, [
      calloutPtr('down', 40, 60), // click 1: tip
      calloutPtr('up', 40, 60),
      calloutPtr('move', 120, 120), // hover toward the knee (leader preview)
      calloutPtr('down', 120, 120), // click 2: knee
      calloutPtr('up', 120, 120),
      calloutPtr('move', 200, 100), // hover toward the box
      calloutPtr('down', 200, 100), // box drag start
      calloutPtr('move', 320, 140),
      calloutPtr('up', 320, 140), // commit
    ]);
    const a = m.byId[m.order[0]];
    expect(a.subtype).toBe('free-text');
    expect(a.geom.t).toBe('text');
    if (a.geom.t !== 'text' || !a.geom.callout) throw new Error('expected callout geom');
    expect(a.geom.callout.tip).toEqual({ x: 40, y: 60 });
    expect(a.geom.callout.knee).toEqual({ x: 120, y: 120 });
    expect(a.geom.callout.ending).toBe('open-arrow');
    expect(a.geom.rect).toMatchObject({ x: 200, y: 100, width: 120, height: 40 });
    expect(m.selected).toEqual([a.id]);
    expect(m.editing).toBe(a.id);
    expect(a.source).toBe('vector');
  });

  it('a click (no drag) for the box step lays a default-sized text box', () => {
    const m = run(initialModel, [
      calloutPtr('down', 40, 60),
      calloutPtr('up', 40, 60),
      calloutPtr('down', 120, 120),
      calloutPtr('up', 120, 120),
      calloutPtr('down', 200, 100), // box click, no travel
      calloutPtr('up', 200, 100),
    ]);
    const a = m.byId[m.order[0]];
    expect(a.geom.t === 'text' && a.geom.rect).toMatchObject({
      x: 200,
      y: 100,
      width: 150,
      height: 40,
    });
  });

  it('the in-progress callout previews via a draft render item, before any commit', () => {
    const m = run(initialModel, [
      calloutPtr('down', 40, 60), // tip placed
      calloutPtr('move', 120, 120), // knee-step preview follows the cursor
    ]);
    expect(m.order).toHaveLength(0); // nothing committed yet
    const ghost = pageItems(m, PON).find((i) => i.source === 'ghost');
    expect(ghost).toBeDefined();
  });

  // The box-step ghost geom (the in-progress text box) — drives the no-bounce check.
  const ghostBox = (m: Model) => {
    const g = pageItems(m, PON).find((i) => i.source === 'ghost')?.geom;
    return g && g.t === 'text' ? g.rect : null;
  };

  it('pressing for the box keeps the DEFAULT box until a real drag (no bounce)', () => {
    // tip → knee → press the box at (200,100); a sub-threshold jiggle must NOT
    // collapse the preview to a sliver — it stays the 150x40 default at the press.
    const m = run(initialModel, [
      calloutPtr('down', 40, 60),
      calloutPtr('up', 40, 60),
      calloutPtr('down', 120, 120),
      calloutPtr('up', 120, 120),
      calloutPtr('down', 200, 100), // box press
      calloutPtr('move', 201, 101), // 1-unit jiggle (< MIN_DRAG)
    ]);
    expect(ghostBox(m)).toMatchObject({ x: 200, y: 100, width: 150, height: 40 });
  });

  it('once the drag passes MIN_DRAG the box preview follows the pointer', () => {
    const m = run(initialModel, [
      calloutPtr('down', 40, 60),
      calloutPtr('up', 40, 60),
      calloutPtr('down', 120, 120),
      calloutPtr('up', 120, 120),
      calloutPtr('down', 200, 100), // box press
      calloutPtr('move', 320, 150), // a real drag (>> MIN_DRAG)
    ]);
    // preview is now the dragged rect — and it matches what an up would commit
    expect(ghostBox(m)).toMatchObject({ x: 200, y: 100, width: 120, height: 50 });
    const committed = update(m, calloutPtr('up', 320, 150))[0];
    const a = committed.byId[committed.order[0]];
    expect(a.geom.t === 'text' && a.geom.rect).toMatchObject({
      x: 200,
      y: 100,
      width: 120,
      height: 50,
    });
  });
});

describe('annotation-core — rotation', () => {
  const seededSquare = (
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ): Annot => ({
    id,
    ref: {
      kind: 'objectNumber',
      pageObjectNumber: 1,
      annotObjectNumber: Number(id.slice(1)),
    } as Annot['ref'],
    pon: PON,
    subtype: 'square',
    geom: { t: 'rect', rect, ellipse: false },
    style: initialModel.style,
    locked: false,
    source: 'baked',
  });

  it('box rotates about its own centre: rot adds, centre + size fixed', () => {
    const g: Geom = { t: 'rect', rect: { x: 100, y: 100, width: 100, height: 50 }, ellipse: false };
    const r = geomRotateAbout(g, centroidOf(g), 90);
    expect(geomRotation(r)).toBe(90);
    if (r.t !== 'rect') throw new Error('expected rect');
    expect(centroidOf(r)).toMatchObject({ x: 150, y: 125 }); // centre preserved
    expect(r.rect.width).toBe(100); // stored box stays UNROTATED
    expect(r.rect.height).toBe(50);
  });

  it('vertex rotation is additive about the centroid and reset is exact', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
    ];
    const g: Geom = { t: 'poly', points: pts.map((p) => ({ ...p })), closed: false };
    const c0 = centroidOf(g);
    const r1 = geomRotateAbout(g, centroidOf(g), 30);
    const r2 = geomRotateAbout(r1, centroidOf(r1), 30);
    expect(geomRotation(r2)).toBe(60); // θ is additive
    const c2 = centroidOf(r2);
    expect(c2.x).toBeCloseTo(c0.x); // centroid is the fixed pivot
    expect(c2.y).toBeCloseTo(c0.y);
    const reset = geomResetRotation(r2);
    expect(geomRotation(reset)).toBe(0);
    if (reset.t !== 'poly') throw new Error('expected poly');
    reset.points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(pts[i].x); // points return to as-authored
      expect(p.y).toBeCloseTo(pts[i].y);
    });
  });

  it('obbFromGeom reconstructs an oriented box from θ for both families', () => {
    const box: Geom = {
      t: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      ellipse: false,
      rot: 90,
    };
    const obbBox = obbFromGeom(box, 0);
    expect(obbBox?.angle).toBe(90);
    expect(obbBox?.corners).toHaveLength(4);

    // a vertex shape: spin the same points by 45° and the OBB tilts to match.
    const base: Geom = {
      t: 'poly',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      closed: true,
    };
    const turned = geomRotateAbout(base, centroidOf(base), 45);
    const obbV = obbFromGeom(turned, 0);
    expect(obbV?.angle).toBe(45);
    expect(obbV?.corners).toHaveLength(4);
  });

  it('rotatedAabb: a square is unchanged at 90°, grows by √2 at 45°', () => {
    const sq = { x: 0, y: 0, width: 100, height: 100 };
    expect(rotatedAabb(sq, 90).width).toBeCloseTo(100);
    expect(rotatedAabb(sq, 45).width).toBeCloseTo(Math.SQRT2 * 100, 3);
  });

  it('normalizeDeg wraps into [0,360)', () => {
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(450)).toBe(90);
    expect(normalizeDeg(360)).toBe(0);
  });

  it('rotate90 turns a single selected shape about its centre (one patch)', () => {
    const base = update(initialModel, {
      t: 'loaded',
      annots: [seededSquare('s1', { x: 100, y: 100, width: 100, height: 50 })],
    })[0];
    const [m, fx] = update({ ...base, selected: ['s1'] }, { t: 'rotate90' });
    expect(fx).toEqual([{ fx: 'patch', id: 's1' }]);
    const g = m.byId['s1'].geom;
    expect(geomRotation(g)).toBe(90);
    expect(centroidOf(g)).toMatchObject({ x: 150, y: 125 });
  });

  it('rotate90 on a group turns every member about the union centre (one patch each)', () => {
    const base = update(initialModel, {
      t: 'loaded',
      annots: [
        seededSquare('s1', { x: 0, y: 0, width: 100, height: 100 }),
        seededSquare('s2', { x: 200, y: 0, width: 100, height: 100 }),
      ],
    })[0];
    const [m, fx] = update({ ...base, selected: ['s1', 's2'] }, { t: 'rotate90' });
    expect(fx).toHaveLength(2);
    expect(geomRotation(m.byId['s1'].geom)).toBe(90);
    expect(geomRotation(m.byId['s2'].geom)).toBe(90);
    // the two boxes orbit the union centre, so their centres swap places vertically
    expect(centroidOf(m.byId['s1'].geom).x).not.toBe(50);
  });

  it('resetRotation clears rotation on the selection (one patch per rotated member)', () => {
    const base = update(initialModel, {
      t: 'loaded',
      annots: [seededSquare('s1', { x: 100, y: 100, width: 100, height: 50 })],
    })[0];
    const rotated = update({ ...base, selected: ['s1'] }, { t: 'rotate90' })[0];
    const [m, fx] = update(rotated, { t: 'resetRotation' });
    expect(fx).toEqual([{ fx: 'patch', id: 's1' }]);
    expect(geomRotation(m.byId['s1'].geom)).toBe(0);
  });
});

describe('annotation-core — rotation-aware selection (grab + menu + group)', () => {
  const square = (id: string, geom: Geom): Annot => ({
    id,
    ref: {
      kind: 'objectNumber',
      pageObjectNumber: 1,
      annotObjectNumber: Number(id.slice(1)),
    } as Annot['ref'],
    pon: PON,
    subtype: 'square',
    geom,
    style: initialModel.style,
    locked: false,
    source: 'baked',
  });
  const rect = (x: number, y: number, width: number, height: number): Geom => ({
    t: 'rect',
    rect: { x, y, width, height },
    ellipse: false,
  });

  it('a SELECTED rotated box is grabbable across its TILTED body, not its footprint', () => {
    // 100×50 box at (100,100); turned 90° about its centre (150,125) it becomes a
    // 50×100 box spanning x[125,175], y[75,175]. The unrotated footprint was
    // x[100,200], y[100,150].
    const base = update(initialModel, {
      t: 'loaded',
      annots: [square('s1', rect(100, 100, 100, 50))],
    })[0];
    const rotated = update({ ...base, selected: ['s1'] }, { t: 'rotate90' })[0];

    // (150,90): inside the tilted box but ABOVE the old footprint (y<100) — now grabs.
    expect(hitTest(rotated, PON, { x: 150, y: 90 }, 6, 3)).toEqual({ t: 'annot', id: 's1' });
    // (110,140): inside the old footprint but LEFT of the tilted box (x<125) — vacated.
    expect(hitTest(rotated, PON, { x: 110, y: 140 }, 6, 3).t).toBe('empty');
  });

  it('the menu anchor is the ROTATED AABB and tracks rot (not the fixed unrotated box)', () => {
    const base = update(initialModel, {
      t: 'loaded',
      annots: [square('s1', rect(100, 100, 100, 50))],
    })[0];
    const before = selectionBoundsOnPage({ ...base, selected: ['s1'] }, PON);
    expect(before).toMatchObject({ x: 100, y: 100, width: 100, height: 50 }); // upright = the box

    const rotated = update({ ...base, selected: ['s1'] }, { t: 'rotate90' })[0];
    const after = selectionBoundsOnPage(rotated, PON);
    // 90° → the AABB is the box's transpose, recentred on (150,125).
    expect(after?.x).toBeCloseTo(125);
    expect(after?.y).toBeCloseTo(75);
    expect(after?.width).toBeCloseTo(50);
    expect(after?.height).toBeCloseTo(100);
    // it MOVED — the bug was the anchor never changing when you rotate.
    expect(after).not.toMatchObject({ x: 100, y: 100, width: 100, height: 50 });
  });

  it('groupUnionBounds encloses a rotated member’s tilted corners', () => {
    const tilted = geomRotateAbout(rect(0, 0, 100, 100), centroidOf(rect(0, 0, 100, 100)), 45);
    const m = update(initialModel, {
      t: 'loaded',
      annots: [square('s1', tilted), square('s2', rect(200, 0, 100, 100))],
    })[0];
    const union = groupUnionBounds({ ...m, selected: ['s1', 's2'] }, PON);
    // a 100×100 box turned 45° about its centre (50,50) reaches out to ~−20.7.
    expect(union).not.toBeNull();
    expect(union!.x).toBeCloseTo(50 - (100 * Math.SQRT2) / 2, 3); // ≈ -20.71
    expect(union!.x + union!.width).toBeCloseTo(300); // s2 still bounds the right edge
  });

  it('selectionQuad of an upright box is just its axis-aligned corners', () => {
    const quad = selectionQuad(rect(10, 20, 100, 40), 0);
    expect(quad).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 60 },
      { x: 10, y: 60 },
    ]);
  });
});

describe('annotation-core — rotation pivots about the rect centre', () => {
  const square = (id: string, geom: Geom): Annot => ({
    id,
    ref: {
      kind: 'objectNumber',
      pageObjectNumber: 1,
      annotObjectNumber: Number(id.slice(1)),
    } as Annot['ref'],
    pon: PON,
    subtype: 'square',
    geom,
    style: initialModel.style,
    locked: false,
    source: 'baked',
  });

  it('selectionCenter of a box is the rect centre, before AND after a quarter-turn', () => {
    const g: Geom = { t: 'rect', rect: { x: 100, y: 100, width: 100, height: 50 }, ellipse: false };
    expect(selectionCenter(g, 0)).toMatchObject({ x: 150, y: 125 });
    const turned = geomRotateAbout(g, selectionCenter(g, 0), 90);
    const c = selectionCenter(turned, 0);
    expect(c.x).toBeCloseTo(150);
    expect(c.y).toBeCloseTo(125);
  });

  it('a vertex shape spins in place about selectionCenter, NOT its off-centre vertex mean', () => {
    // An L-shaped (asymmetric) polyline: its vertex mean sits well away from the
    // centre of the bounding rect.
    const g: Geom = {
      t: 'poly',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 20, y: 100 },
        { x: 20, y: 20 },
        { x: 100, y: 20 },
        { x: 100, y: 0 },
      ],
      closed: false,
    };
    const mean = centroidOf(g);
    const centre = selectionCenter(g, 0);
    // the two are genuinely different for an asymmetric shape (the whole bug).
    expect(Math.hypot(mean.x - centre.x, mean.y - centre.y)).toBeGreaterThan(5);

    // rotating about the selection centre keeps that centre fixed → spins in place.
    const spun = geomRotateAbout(g, centre, 37);
    const after = selectionCenter(spun, 0);
    expect(after.x).toBeCloseTo(centre.x, 6);
    expect(after.y).toBeCloseTo(centre.y, 6);

    // rotating about the vertex mean (the OLD behaviour) drifts the visible centre.
    const swung = geomRotateAbout(g, mean, 37);
    const drifted = selectionCenter(swung, 0);
    expect(Math.hypot(drifted.x - centre.x, drifted.y - centre.y)).toBeGreaterThan(1);
  });

  it('a rotate gesture on a vertex shape pivots about the selection centre and keeps it fixed', () => {
    const g: Geom = {
      t: 'poly',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 20, y: 100 },
        { x: 20, y: 20 },
        { x: 100, y: 20 },
        { x: 100, y: 0 },
      ],
      closed: false,
    };
    const poly: Annot = { ...square('s1', g), subtype: 'polyline' };
    const base = update(initialModel, { t: 'loaded', annots: [poly] })[0];
    const m = { ...base, selected: ['s1'] };
    const centre = selectionCenter(g, poly.style.strokeWidth);

    // find the rotate knob, then start + drag the gesture there.
    const obb = obbFromGeom(g, poly.style.strokeWidth)!;
    const corners = obb.corners;
    const fromMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
    const down = { x: corners[3].x - corners[0].x, y: corners[3].y - corners[0].y };
    const len = Math.hypot(down.x, down.y) || 1;
    const knob = { x: fromMid.x - (down.x / len) * 24, y: fromMid.y - (down.y / len) * 24 };

    const started = update(m, {
      t: 'editPointer',
      phase: 'down',
      in: { pon: PON, point: knob, shift: false },
    })[0];
    expect(started.draft?.g).toBe('rotate');
    if (started.draft?.g === 'rotate') {
      expect(started.draft.pivot.x).toBeCloseTo(centre.x, 6);
      expect(started.draft.pivot.y).toBeCloseTo(centre.y, 6);
    }

    // drag to some other angle and commit; the selection centre must not move.
    const moved = update(started, {
      t: 'editPointer',
      phase: 'move',
      in: { pon: PON, point: { x: knob.x + 40, y: knob.y + 40 }, shift: false },
    })[0];
    const up = update(moved, {
      t: 'editPointer',
      phase: 'up',
      in: { pon: PON, point: { x: knob.x + 40, y: knob.y + 40 }, shift: false },
    })[0];
    const after = selectionCenter(up.byId['s1'].geom, up.byId['s1'].style.strokeWidth);
    expect(after.x).toBeCloseTo(centre.x, 4);
    expect(after.y).toBeCloseTo(centre.y, 4);
    expect(geomRotation(up.byId['s1'].geom)).not.toBe(0);
  });
});

describe('annotation-core — selectionAnchor carries the knob alongside a centred box', () => {
  const square = (id: string, geom: Geom): Annot => ({
    id,
    ref: {
      kind: 'objectNumber',
      pageObjectNumber: 1,
      annotObjectNumber: Number(id.slice(1)),
    } as Annot['ref'],
    pon: PON,
    subtype: 'square',
    geom,
    style: initialModel.style,
    locked: false,
    source: 'baked',
  });
  const rect = (x: number, y: number, width: number, height: number): Geom => ({
    t: 'rect',
    rect: { x, y, width, height },
    ellipse: false,
  });

  it('a rotatable selection: bounds equal selectionBoundsOnPage (centred, NOT grown) and a knob is present', () => {
    const base = update(initialModel, {
      t: 'loaded',
      annots: [square('s1', rect(100, 100, 100, 50))],
    })[0];
    const m = { ...base, selected: ['s1'] };
    const anchor = selectionAnchor(m);
    expect(anchor).not.toBeNull();
    // The box is the plain selection box — the knob is NOT folded in (no growth).
    expect(anchor!.bounds).toEqual(selectionBoundsOnPage(m, PON));
    expect(anchor!.knob).toBeDefined();
  });

  it('a non-rotatable selection (highlight) exposes a box but NO knob', () => {
    const hi: Annot = {
      ...square('s2', {
        t: 'quads',
        quads: [
          [
            { x: 10, y: 10 },
            { x: 90, y: 10 },
            { x: 10, y: 22 },
            { x: 90, y: 22 },
          ],
        ],
      }),
      subtype: 'highlight',
    };
    const base = update(initialModel, { t: 'loaded', annots: [hi] })[0];
    const m = { ...base, selected: ['s2'] };
    const anchor = selectionAnchor(m);
    expect(anchor).not.toBeNull();
    expect(anchor!.bounds).toEqual(selectionBoundsOnPage(m, PON));
    expect(anchor!.knob).toBeUndefined();
  });
});

describe('annotation-core — join-aware stroke bounds', () => {
  const poly = (points: Vec[], closed: boolean): Geom => ({ t: 'poly', points, closed });

  it('a sharp join sticks out only on the spike side — the box is NOT symmetric', () => {
    // A tent "^" with a sharp apex at (50,0); arms come down to y=100.
    const g = poly(
      [
        { x: 0, y: 100 },
        { x: 50, y: 0 },
        { x: 100, y: 100 },
      ],
      false,
    );
    const sw = 10;
    const h = sw / 2;
    const b = geomVisualBounds(g, sw);

    // The mitred apex spikes ABOVE y=0 by h/cos(delta/2) = h*sqrt(5) ≈ 11.18.
    const spike = h * Math.sqrt(5);
    expect(b.y).toBeCloseTo(-spike, 3);

    // The far (bottom) side gets only a thin offset (h/sqrt(5)), NOT the same pad —
    // the whole point: a pointy join grows only its own side.
    const topPad = 0 - b.y;
    const botPad = b.y + b.height - 100;
    expect(botPad).toBeCloseTo(h / Math.sqrt(5), 3);
    expect(topPad).toBeGreaterThan(botPad * 3);
  });

  it('the miter limit bevels a near-reversal join instead of exploding the box', () => {
    // A hairpin at (100,0): the outgoing segment doubles almost straight back, so an
    // ungated miter would shoot out ~190*h. The limit must clamp it to the bevel.
    const g = poly(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 2, y: 1 },
      ],
      false,
    );
    const sw = 10;
    const h = sw / 2;
    const b = geomVisualBounds(g, sw);
    // Bounded by the vertex hull grown by the bevel (~h), nowhere near the ~190*h spike.
    expect(b.width).toBeLessThan(100 + 4 * h);
    expect(b.height).toBeLessThan(20 * h);
  });

  it('a closed polygon wraps its stroke (parity with a polyline), not tight to the vertices', () => {
    const g = poly(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      true,
    );
    const sw = 8;
    const h = sw / 2;
    const sb = selectionBounds(g, sw);
    // selectionBounds now routes polygons through the stroke-aware visual bounds…
    expect(sb).toEqual(geomVisualBounds(g, sw));
    // …so the outline sits OUTSIDE the tight vertex box (a 90° corner miters to -h).
    const tight = geomBounds(g);
    expect(sb.x).toBeCloseTo(-h, 3);
    expect(sb.y).toBeCloseTo(-h, 3);
    expect(sb.width).toBeGreaterThan(tight.width);
    expect(sb.height).toBeGreaterThan(tight.height);
  });

  it('ink bounds are unchanged — a plain h grow of the freehand hull (round, never spikes)', () => {
    const g: Geom = {
      t: 'ink',
      strokes: [
        [
          { x: 10, y: 10 },
          { x: 60, y: 15 },
          { x: 40, y: 90 },
        ],
      ],
    };
    const sw = 6;
    const h = sw / 2;
    const b = geomVisualBounds(g, sw);
    const hull = geomBounds(g);
    expect(b).toEqual({
      x: hull.x - h,
      y: hull.y - h,
      width: hull.width + sw,
      height: hull.height + sw,
    });
  });

  it('a mitred arrowhead tip is fully enclosed — the box reaches ~sw past the tip vertex', () => {
    // Horizontal line pointing right, closed arrow at the tip (100,0).
    const g: Geom = {
      t: 'line',
      a: { x: 0, y: 0 },
      b: { x: 100, y: 0 },
      ends: { start: 'none', end: 'closed-arrow' },
    };
    const sw = 6;
    const b = geomVisualBounds(g, sw);
    // The arrowhead tip is a 60° corner: the mitred stroke reaches h/sin(30°) = sw
    // past the tip vertex. The right edge must clear that (old flat h/2 pad did not).
    expect(b.x + b.width).toBeGreaterThanOrEqual(100 + sw - 1e-6);
  });

  it('scene paint: only ink rounds its joins; shapes and polys stay sharp (miter)', () => {
    const mk = (subtype: Subtype, geom: Geom): RenderItem => ({
      id: 'x',
      ref: null,
      subtype,
      geom,
      box: geomVisualBounds(geom, 4),
      style: {
        color: '#000000',
        interiorColor: null,
        strokeWidth: 4,
        opacity: 1,
        border: { kind: 'solid' },
      },
      source: 'vector',
      selected: false,
    });
    const square = mk('square', {
      t: 'rect',
      rect: { x: 0, y: 0, width: 50, height: 40 },
      ellipse: false,
    });
    const polyline = mk(
      'polyline',
      poly(
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 40 },
        ],
        false,
      ),
    );
    const polygon = mk(
      'polygon',
      poly(
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 40 },
        ],
        true,
      ),
    );
    const ink = mk('ink', {
      t: 'ink',
      strokes: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
          { x: 40, y: 0 },
        ],
      ],
    });

    expect(scene(square)[0].paint.join).toBeUndefined();
    expect(scene(polyline)[0].paint.join).toBeUndefined();
    expect(scene(polygon)[0].paint.join).toBeUndefined();
    expect(scene(ink)[0].paint.join).toBe('round');
  });
});

describe('annotation-core opaqueBody (stamp) gestures', () => {
  const STAMP_RECT = { x: 100, y: 100, width: 100, height: 50 };
  const stamp = (): Annot => ({
    id: 'S1',
    ref: { kind: 'objectNumber', pageObjectNumber: PON, annotObjectNumber: 900 },
    pon: PON,
    subtype: 'stamp',
    geom: { t: 'rect', rect: { ...STAMP_RECT }, ellipse: false },
    style: {
      color: '#000000',
      interiorColor: null,
      strokeWidth: 1,
      opacity: 1,
      border: { kind: 'solid' },
    },
    locked: false,
    source: 'baked',
    apBox: { ...STAMP_RECT },
  });
  const loadStamp = (): Model => update(initialModel, { t: 'loaded', annots: [stamp()] })[0];

  it('stays baked MID-resize with the raster box following the live geometry', () => {
    // select (body click — opaqueBody hits anywhere inside), then grab the SE
    // handle at (200,150) and drag WITHOUT releasing.
    let m = run(loadStamp(), [editPtr('down', 150, 125), editPtr('up', 150, 125)]);
    m = run(m, [editPtr('down', 200, 150), editPtr('move', 260, 180)]);
    const item = pageItems(m, PON).find((i) => i.subtype === 'stamp')!;
    expect(item.source).toBe('baked'); // never flips: there is no vector render
    expect(item.apBox).toMatchObject({ x: 100, y: 100, width: 160, height: 80 });
  });

  it('stays baked AFTER the resize commits, apBox at the new rect', () => {
    let m = run(loadStamp(), [editPtr('down', 150, 125), editPtr('up', 150, 125)]);
    m = run(m, [editPtr('down', 200, 150), editPtr('move', 260, 180), editPtr('up', 260, 180)]);
    const a = m.byId['S1'];
    expect(a.source).toBe('baked');
    expect(a.apBox).toMatchObject({ x: 100, y: 100, width: 160, height: 80 });
    const item = pageItems(m, PON).find((i) => i.subtype === 'stamp')!;
    expect(item.source).toBe('baked');
  });

  it('stays baked MID-rotate with the live rotation exposed as apRot (view transform)', () => {
    // select the stamp, grab its rotate knob, and drag WITHOUT releasing
    let m = run(loadStamp(), [editPtr('down', 150, 125), editPtr('up', 150, 125)]);
    const knob = selectionKnob(m, PON)!;
    expect(knob).toBeTruthy();
    // rotate the grab point 30° about the stamp centre
    const c = { x: 150, y: 125 };
    const a0 = Math.atan2(knob.at.y - c.y, knob.at.x - c.x);
    const a1 = a0 + (30 * Math.PI) / 180;
    const r0 = Math.hypot(knob.at.x - c.x, knob.at.y - c.y);
    m = run(m, [
      editPtr('down', knob.at.x, knob.at.y),
      editPtr('move', c.x + r0 * Math.cos(a1), c.y + r0 * Math.sin(a1)),
    ]);
    const item = pageItems(m, PON).find((i) => i.subtype === 'stamp')!;
    expect(item.source).toBe('baked'); // the bitmap never disappears mid-rotate
    expect(Math.abs((item.apRot ?? 0) - 30)).toBeLessThan(1); // ...and spins live
  });

  it('a square mid-resize still flips to vector (unchanged behaviour)', () => {
    let m = run(initialModel, [
      createPtr('square', 'down', 100, 100),
      createPtr('square', 'move', 200, 200),
      createPtr('square', 'up', 200, 200),
    ]);
    m = run(m, [editPtr('down', 200, 200), editPtr('move', 260, 240)]);
    const item = pageItems(m, PON)[0];
    expect(item.source).toBe('vector');
  });
});
