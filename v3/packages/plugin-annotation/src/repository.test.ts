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
