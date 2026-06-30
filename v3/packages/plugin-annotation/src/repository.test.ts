import { describe, expect, it } from 'vitest';
import type {
  AnnotationDraft,
  AnnotationDTO,
  AnnotationFlags,
  AnnotationPatch,
  AnnotationRef,
  CalloutLine,
  PdfRect,
} from '@embedpdf/engine-core/runtime';
import { fromDTO, refKey, toCreateDraft, toPatch } from './repository';

const CROP: PdfRect = { left: 0, bottom: 0, right: 600, top: 800 };

const NO_FLAGS: AnnotationFlags = {
  invisible: false,
  hidden: false,
  print: false,
  noZoom: false,
  noRotate: false,
  noView: false,
  readOnly: false,
  locked: false,
  toggleNoView: false,
  lockedContents: false,
};

/** A minimal committed square DTO, with optional relationship fields. */
function squareDTO(
  annotObjectNumber: number,
  rel?: { inReplyTo: AnnotationRef | null; replyType: 'reply' | 'group' | null },
): AnnotationDTO {
  const ref: AnnotationRef = { kind: 'objectNumber', pageObjectNumber: 1, annotObjectNumber };
  return {
    ref,
    pageObjectNumber: 1,
    index: 0,
    identityQuality: 'durable',
    nm: null,
    flags: NO_FLAGS,
    rect: { left: 100, bottom: 100, right: 200, top: 200 },
    contents: null,
    author: null,
    created: null,
    modified: null,
    inReplyTo: rel?.inReplyTo ?? null,
    replyType: rel?.replyType ?? null,
    subtype: 'square',
    color: { r: 0, g: 0, b: 0 },
    interiorColor: null,
    strokeWidth: 2,
    opacity: 1,
    borderStyle: 'solid',
  } as AnnotationDTO;
}

describe('repository.fromDTO — group/relationship mapping', () => {
  it('leaves irt/group undefined for a top-level annotation', () => {
    const a = fromDTO(squareDTO(10), CROP);
    expect(a.irt).toBeUndefined();
    expect(a.group).toBeUndefined();
  });

  it('maps a `/RT /Group` subordinate to both irt and group (the primary key)', () => {
    const primary: AnnotationRef = {
      kind: 'objectNumber',
      pageObjectNumber: 1,
      annotObjectNumber: 10,
    };
    const sub = fromDTO(squareDTO(11, { inReplyTo: primary, replyType: 'group' }), CROP);
    expect(sub.irt).toBe(refKey(primary));
    expect(sub.group).toBe(refKey(primary)); // visual group → acts as a unit
  });

  it('maps a `/RT /R` comment reply to irt only, NOT group (not a visual group)', () => {
    const parent: AnnotationRef = {
      kind: 'objectNumber',
      pageObjectNumber: 1,
      annotObjectNumber: 10,
    };
    const reply = fromDTO(squareDTO(12, { inReplyTo: parent, replyType: 'reply' }), CROP);
    expect(reply.irt).toBe(refKey(parent));
    expect(reply.group).toBeUndefined();
  });
});

/* ── callout free-text round-trip ─────────────────────────────────────────────
 * Coordinates are PDF user space (y-up). With this CROP, content = (x, 800 - y).
 * The text box PDF rect is {200,600,320,660}; the overall /Rect {30,590,330,745}
 * encloses the box + the leader (tip 40,740; knee 120,700) + the arrow; `/RD`
 * recovers the box from the overall. The 3rd `/CL` point (the connection) is
 * authored arbitrarily — the reader ignores it and re-derives off the box.
 */
const BOX_PDF: PdfRect = { left: 200, bottom: 600, right: 320, top: 660 };
const OVERALL_PDF: PdfRect = { left: 30, bottom: 590, right: 330, top: 745 };
const CL: CalloutLine = [
  { x: 40, y: 740 }, // tip
  { x: 120, y: 700 }, // knee
  { x: 200, y: 630 }, // connection (ignored on read)
];

function calloutDTO(annotObjectNumber = 20): AnnotationDTO {
  const ref: AnnotationRef = { kind: 'objectNumber', pageObjectNumber: 1, annotObjectNumber };
  return {
    ref,
    pageObjectNumber: 1,
    index: 0,
    identityQuality: 'durable',
    nm: null,
    flags: NO_FLAGS,
    rect: OVERALL_PDF,
    contents: 'see here',
    author: null,
    created: null,
    modified: null,
    inReplyTo: null,
    replyType: null,
    subtype: 'free-text',
    intent: 'free-text-callout',
    fontFamily: 'helvetica',
    fontSize: 14,
    textAlign: 'left',
    color: { r: 200, g: 0, b: 0 },
    interiorColor: null,
    opacity: 1,
    strokeWidth: 1,
    borderStyle: 'solid',
    rectDifferences: {
      left: BOX_PDF.left - OVERALL_PDF.left, // 170
      bottom: BOX_PDF.bottom - OVERALL_PDF.bottom, // 10
      right: OVERALL_PDF.right - BOX_PDF.right, // 10
      top: OVERALL_PDF.top - BOX_PDF.top, // 85
    },
    calloutLine: CL,
    lineEnding: 'open-arrow',
  } as AnnotationDTO;
}

/** A plain free-text DTO (no leader) for the contrast case. */
function plainFreeTextDTO(annotObjectNumber = 21): AnnotationDTO {
  return {
    ...calloutDTO(annotObjectNumber),
    intent: 'free-text',
    rect: BOX_PDF,
    rectDifferences: undefined,
    calloutLine: undefined,
    lineEnding: undefined,
  } as AnnotationDTO;
}

/* ── rotation round-trip (CW content ↔ PDF convention) ────────────────────────
 * The model carries `rot` CLOCKWISE in content space; the engine DTO carries
 * `/EMBD_Metadata/Rotation` in PDF convention. The repository converts ONCE at
 * this seam: `rot_content = -rotation_pdf (mod 360)` and back. Box kinds also
 * split `/Rect` (the rotated AABB) from `unrotatedRect` (the logical box); vertex
 * kinds keep an advisory scalar only (the points are already rotated).
 */
function rotatedSquareDTO(rotationPdf: number, annotObjectNumber = 30): AnnotationDTO {
  return {
    ...squareDTO(annotObjectNumber),
    // /Rect is the rotated AABB; for a square turned 90° it equals the box.
    rect: { left: 100, bottom: 100, right: 200, top: 200 },
    rotation: rotationPdf,
    unrotatedRect: { left: 100, bottom: 100, right: 200, top: 200 },
  } as AnnotationDTO;
}

function rotatedPolylineDTO(rotationPdf: number, annotObjectNumber = 31): AnnotationDTO {
  const ref: AnnotationRef = { kind: 'objectNumber', pageObjectNumber: 1, annotObjectNumber };
  return {
    ref,
    pageObjectNumber: 1,
    index: 0,
    identityQuality: 'durable',
    nm: null,
    flags: NO_FLAGS,
    rect: { left: 100, bottom: 100, right: 300, top: 300 },
    contents: null,
    author: null,
    created: null,
    modified: null,
    inReplyTo: null,
    replyType: null,
    subtype: 'polyline',
    color: { r: 0, g: 0, b: 0 },
    interiorColor: null,
    strokeWidth: 2,
    opacity: 1,
    borderStyle: 'solid',
    vertices: [
      { x: 120, y: 120 },
      { x: 200, y: 260 },
      { x: 280, y: 140 },
    ],
    lineEndings: { start: 'none', end: 'none' },
    rotation: rotationPdf,
  } as AnnotationDTO;
}

describe('repository — rotation round-trip', () => {
  it('box: fromDTO reads unrotatedRect + converts PDF→CW content rot', () => {
    const a = fromDTO(rotatedSquareDTO(90), CROP);
    if (a.geom.t !== 'rect') throw new Error('expected rect geom');
    // unrotatedRect {100,100,200,200} → content {x:100,y:600,w:100,h:100}
    expect(a.geom.rect).toMatchObject({ x: 100, y: 600, width: 100, height: 100 });
    // PDF 90° → CW content 270° (negation mod 360, from the y-flip)
    expect(a.geom.rot).toBe(270);
  });

  it('box: toPatch emits rect(AABB) + unrotatedRect + rotation (CW→PDF back)', () => {
    const patch = toPatch(fromDTO(rotatedSquareDTO(90), CROP), CROP) as Extract<
      AnnotationPatch,
      { subtype: 'square' }
    > & { rotation?: number; unrotatedRect?: PdfRect };
    if (!patch) throw new Error('expected a patch');
    expect(patch.rotation).toBe(90); // round-trips back to the PDF angle
    expect(patch.unrotatedRect).toMatchObject({ left: 100, bottom: 100, right: 200, top: 200 });
    // the square turned a quarter-turn still spans the same AABB
    if (!patch.rect) throw new Error('expected a rect');
    expect(patch.rect.left).toBeCloseTo(100);
    expect(patch.rect.right).toBeCloseTo(200);
  });

  it('box: an unrotated DTO carries no rotation metadata back out', () => {
    const patch = toPatch(fromDTO(squareDTO(32), CROP), CROP) as Extract<
      AnnotationPatch,
      { subtype: 'square' }
    > & { rotation?: number; unrotatedRect?: PdfRect };
    if (!patch) throw new Error('expected a patch');
    expect(patch.rotation).toBeUndefined();
    expect(patch.unrotatedRect).toBeUndefined();
  });

  it('vertex: advisory rotation round-trips and the points stay authoritative', () => {
    const a = fromDTO(rotatedPolylineDTO(30), CROP);
    if (a.geom.t !== 'poly') throw new Error('expected poly geom');
    expect(a.geom.rot).toBe(330); // -30 mod 360
    // the points are the visual — first vertex maps straight through the y-flip
    expect(a.geom.points[0]).toEqual({ x: 120, y: 680 });

    const patch = toPatch(a, CROP) as Extract<AnnotationPatch, { subtype: 'polyline' }> & {
      rotation?: number;
      unrotatedRect?: PdfRect;
    };
    if (!patch) throw new Error('expected a patch');
    expect(patch.rotation).toBe(30); // back to the PDF angle
    expect(patch).not.toHaveProperty('unrotatedRect'); // vertex kinds never carry one
    expect(patch.vertices?.[0]).toMatchObject({ x: 120, y: 120 });
  });

  it('vertex: an unrotated polyline carries no rotation back out', () => {
    const a = fromDTO(rotatedPolylineDTO(0, 33), CROP);
    expect(a.geom.t === 'poly' && a.geom.rot).toBeFalsy();
    const patch = toPatch(a, CROP) as Extract<AnnotationPatch, { subtype: 'polyline' }> & {
      rotation?: number;
    };
    expect(patch?.rotation).toBeUndefined();
  });
});

describe('repository — free-text callout mapping', () => {
  it('fromDTO: intent + /CL + /RD → a text geom with a leader (box recovered, conn dropped)', () => {
    const a = fromDTO(calloutDTO(), CROP);
    expect(a.geom.t).toBe('text');
    if (a.geom.t !== 'text' || !a.geom.callout) throw new Error('expected callout geom');
    // text box = overall inset by /RD, in content space
    expect(a.geom.rect).toMatchObject({ x: 200, y: 140, width: 120, height: 60 });
    // tip / knee map to content space (y flips about the 800-pt crop)
    expect(a.geom.callout.tip).toEqual({ x: 40, y: 60 });
    expect(a.geom.callout.knee).toEqual({ x: 120, y: 100 });
    expect(a.geom.callout.ending).toBe('open-arrow');
  });

  it('fromDTO: a plain free-text (no /CL) has no callout', () => {
    const a = fromDTO(plainFreeTextDTO(), CROP);
    expect(a.geom.t).toBe('text');
    expect(a.geom.t === 'text' && a.geom.callout).toBeUndefined();
  });

  it('toCreateDraft: a callout geom → intent + overall /Rect + /CL + /RD + /LE', () => {
    const draft = toCreateDraft(fromDTO(calloutDTO(), CROP), CROP) as Extract<
      AnnotationDraft,
      { subtype: 'free-text' }
    >;
    expect(draft.intent).toBe('free-text-callout');
    expect(draft.lineEnding).toBe('open-arrow');
    // tip + knee round-trip back to PDF user space
    expect(draft.calloutLine).toBeDefined();
    expect(draft.calloutLine!).toHaveLength(3); // [tip, knee, derived conn]
    expect(draft.calloutLine![0].x).toBeCloseTo(40);
    expect(draft.calloutLine![0].y).toBeCloseTo(740);
    expect(draft.calloutLine![1].x).toBeCloseTo(120);
    expect(draft.calloutLine![1].y).toBeCloseTo(700);
    // the overall /Rect reaches the tip (x≈40) and still covers the box (right≈320)
    expect(draft.rect.left).toBeLessThanOrEqual(40);
    expect(draft.rect.right).toBeGreaterThanOrEqual(320);
    expect(draft.rect.top).toBeGreaterThanOrEqual(740); // y-up: the tip is the high edge
    // every /RD inset is non-negative (the box is inside the overall)
    const rd = draft.rectDifferences!;
    expect(rd.left).toBeGreaterThanOrEqual(0);
    expect(rd.right).toBeGreaterThanOrEqual(0);
    expect(rd.top).toBeGreaterThanOrEqual(0);
    expect(rd.bottom).toBeGreaterThanOrEqual(0);
  });

  it('toCreateDraft: a plain free-text → intent free-text + the box as /Rect (no leader)', () => {
    const draft = toCreateDraft(fromDTO(plainFreeTextDTO(), CROP), CROP) as Extract<
      AnnotationDraft,
      { subtype: 'free-text' }
    >;
    expect(draft.intent).toBe('free-text');
    expect(draft.calloutLine).toBeUndefined();
    expect(draft.rect).toMatchObject(BOX_PDF);
  });

  it('toPatch: a callout sends the overall /Rect + /CL + /RD + /LE together', () => {
    const patch = toPatch(fromDTO(calloutDTO(), CROP), CROP) as Extract<
      AnnotationPatch,
      { subtype: 'free-text' }
    > | null;
    if (!patch) throw new Error('expected a patch');
    expect(patch.calloutLine).toHaveLength(3);
    expect(patch.lineEnding).toBe('open-arrow');
    expect(patch.rectDifferences).toBeDefined();
    expect(patch.rect!.left).toBeLessThanOrEqual(40);
  });
});
