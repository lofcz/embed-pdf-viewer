import type {
  AnnotationCreateResult,
  AnnotationDeleteResult,
  AnnotationListPageSnapshot,
  AnnotationUpdateResult,
  Engine,
  HighlightDraft,
} from '@embedpdf/engine-core';

/**
 * Engine-agnostic mutation walkthrough. Drives one `create`, one
 * `update` (touching a weak annotation when present, to exercise the
 * opportunistic /NM stamp), and one `delete` (of the just-created
 * annotation, so the fixture is left as we found it). Returns the four
 * observable side-effects so the node + browser entries can render
 * exactly the same payload.
 */
export interface MutationsDemoResult {
  label: string;
  docId: string;
  elapsedMs: number;
  before: AnnotationListPageSnapshot;
  created: AnnotationCreateResult;
  updated: AnnotationUpdateResult | null;
  deleted: AnnotationDeleteResult;
  after: AnnotationListPageSnapshot;
}

const QUAD: HighlightDraft['quadPoints'] = [
  {
    topLeft: { x: 50, y: 100 },
    topRight: { x: 150, y: 100 },
    bottomLeft: { x: 50, y: 80 },
    bottomRight: { x: 150, y: 80 },
  },
];

export async function runMutationsDemo(
  label: string,
  engine: Engine,
  pdfBytes: Uint8Array,
  pageObjectNumber: number,
  docId = `mutations-demo-${label}`,
): Promise<MutationsDemoResult> {
  const started = Date.now();
  const doc = await engine.open({ kind: 'bytes', id: docId, bytes: pdfBytes });
  try {
    const page = doc.page(pageObjectNumber);
    const before = await page.annotations.list();

    // 1) Update a weak annotation FIRST. Update is non-structural so
    //    it leaves the revision generation alone, which means subsequent
    //    index refs are still valid. Doing create first would bump the
    //    revision and invalidate `weak.ref`. This exercises the
    //    opportunistic UUID v4 /NM stamp; the resulting ref will be
    //    `kind: 'nm'`.
    const weak = before.annotations.find((a) => a.identityQuality === 'weak');
    let updated: AnnotationUpdateResult | null = null;
    if (
      weak &&
      (weak.subtype === 'highlight' ||
        weak.subtype === 'underline' ||
        weak.subtype === 'squiggly' ||
        weak.subtype === 'strikeout')
    ) {
      updated = await page.annotations.update(weak.ref, {
        subtype: weak.subtype,
        contents: 'mutation demo: updated weak annot',
      });
    }

    // 2) Create a new highlight. Always durable (engine uses
    //    EPDFPage_CreateAnnot, which produces an indirect object).
    const created = await page.annotations.create({
      subtype: 'highlight',
      contents: 'mutation demo: created',
      author: 'mutations-demo',
      color: { r: 30, g: 144, b: 255 },
      opacity: 0.4,
      quadPoints: QUAD,
    });

    // 3) Delete the annotation we created so the fixture is unchanged.
    const deleted = await page.annotations.delete(created.created.ref);

    const after = await page.annotations.list();

    return {
      label,
      docId: doc.id,
      elapsedMs: Date.now() - started,
      before,
      created,
      updated,
      deleted,
      after,
    };
  } finally {
    await doc.close();
  }
}

/**
 * Compact human-readable view of a `MutationsDemoResult`. Includes the
 * meta envelopes (revision generations, weakRefsInvalidated,
 * shouldRefetch reason) so the demo doubles as a visual contract for
 * the locked impact rules.
 */
export function summarizeMutations(result: MutationsDemoResult) {
  return {
    label: result.label,
    docId: result.docId,
    elapsedMs: result.elapsedMs,
    before: {
      generation: result.before.pageState.revision.generation,
      hasWeak: result.before.pageState.hasAnyWeakAnnotations,
      count: result.before.annotations.length,
    },
    create: {
      ref: refSummary(result.created.created.ref),
      identityQuality: result.created.created.identityQuality,
      meta: metaSummary(result.created.meta),
    },
    update: result.updated
      ? {
          inputRefKind: 'index',
          outputRef: refSummary(result.updated.updated.ref),
          outputNm: result.updated.updated.nm,
          identityQuality: result.updated.updated.identityQuality,
          meta: metaSummary(result.updated.meta),
        }
      : { skipped: 'no weak annotation on the page' },
    delete: {
      deleted: result.deleted.deleted,
      meta: metaSummary(result.deleted.meta),
    },
    after: {
      generation: result.after.pageState.revision.generation,
      hasWeak: result.after.pageState.hasAnyWeakAnnotations,
      count: result.after.annotations.length,
    },
  };
}

function refSummary(ref: { kind: string } & Record<string, unknown>): string {
  switch (ref.kind) {
    case 'objectNumber':
      return `objectNumber=${(ref as { annotObjectNumber: number }).annotObjectNumber}`;
    case 'nm':
      return `nm=${(ref as { nm: string }).nm}`;
    case 'index':
      return `index=${(ref as { index: number }).index}`;
    default:
      return ref.kind;
  }
}

function metaSummary(meta: AnnotationCreateResult['meta']) {
  return {
    generation: meta.pageState.revision.generation,
    weakRefsInvalidated: meta.weakRefsInvalidated,
    shouldRefetch: meta.shouldRefetch?.reason ?? null,
    changed: meta.changed.map((c) => `${c.kind}=${String(c.value)}`),
  };
}
