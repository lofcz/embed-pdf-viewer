import { describe, expect, it } from 'vitest';
import type { PageGeometrySnapshot, PdfRect } from '@embedpdf/engine-core/runtime';
import { buildGlyphs, glyphAt, rectsForRange } from './geometry';

const crop: PdfRect = { left: 0, bottom: 0, right: 100, top: 100 };

// y-up glyph box helper
const glyph = (left: number, bottom: number, w = 8, h = 10) => ({
  looseBox: { left, bottom, right: left + w, top: bottom + h },
  flags: 0,
});

// Two lines near the TOP of the page (high y-up), three glyphs each.
const snapshot: PageGeometrySnapshot = {
  runs: [
    {
      rect: { left: 10, bottom: 90, right: 34, top: 100 },
      charStart: 0,
      glyphs: [glyph(10, 90), glyph(20, 90), glyph(30, 90)],
    },
    {
      rect: { left: 10, bottom: 70, right: 34, top: 80 },
      charStart: 3,
      glyphs: [glyph(10, 70), glyph(20, 70), glyph(30, 70)],
    },
  ],
};

describe('selection geometry bridge', () => {
  it('flips PDF y-up into content y-down (crop-aware)', () => {
    const glyphs = buildGlyphs(snapshot, crop, 0, 1);
    expect(glyphs).toHaveLength(6);
    // First glyph: pdf bottom=90,top=100 → content y = crop.top - top = 0, height 10.
    expect(glyphs[0].rect).toMatchObject({ x: 10, y: 0, width: 8, height: 10 });
    // Line B sits BELOW line A on screen (larger content y), as in PDF it's lower y-up.
    expect(glyphs[3].rect.y).toBeGreaterThan(glyphs[0].rect.y);
  });

  it('hit-tests a glyph at a content point', () => {
    const glyphs = buildGlyphs(snapshot, crop, 0, 1);
    expect(glyphAt(glyphs, { x: 14, y: 5 })).toBe(0); // inside first glyph
    expect(glyphAt(glyphs, { x: 24, y: 25 })).toBe(4); // inside line B, middle glyph
  });

  it('merges a multi-line range into per-line rects', () => {
    const glyphs = buildGlyphs(snapshot, crop, 0, 1);
    const rects = rectsForRange(glyphs, 0, 5); // all six glyphs
    expect(rects).toHaveLength(2); // one rect per line
    expect(rects[0]).toMatchObject({ x: 10, width: 28 }); // line A spans x 10..38
  });
});
