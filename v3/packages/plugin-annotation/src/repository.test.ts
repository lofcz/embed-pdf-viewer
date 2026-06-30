import { describe, expect, it } from 'vitest';
import type {
  AnnotationDTO,
  AnnotationFlags,
  AnnotationRef,
  PdfRect,
} from '@embedpdf/engine-core/runtime';
import { fromDTO, refKey } from './repository';

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
