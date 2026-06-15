import type {
  AnnotationCreateResult,
  AnnotationDeleteResult,
  AnnotationListPageSnapshot,
  AnnotationMoveResult,
  AnnotationRef,
  AnnotationUpdateResult,
  HighlightDraft,
} from '@embedpdf/engine-core';
import type { Engine } from '@embedpdf/engine-core/runtime';

/**
 * Engine-agnostic mutation walkthrough. Drives `update` (weak →
 * /NM-stamped), `create`, two `move` operations (single-as-batch and
 * multi-block contiguous reorder), and finally `delete` to leave the
 * fixture as we found it. Returns the observable side-effects so the
 * node + browser entries can render exactly the same payload.
 */
export interface MutationsDemoResult {
  label: string;
  docId: string;
  elapsedMs: number;
  before: AnnotationListPageSnapshot;
  createdA: AnnotationCreateResult;
  createdB: AnnotationCreateResult;
  updated: AnnotationUpdateResult | null;
  movedSingle: AnnotationMoveResult;
  movedBatch: AnnotationMoveResult;
  deletedA: AnnotationDeleteResult;
  deletedB: AnnotationDeleteResult;
  after: AnnotationListPageSnapshot;
}

const QUAD: HighlightDraft['quadPoints'] = [
  {
    p1: { x: 50, y: 100 },
    p2: { x: 150, y: 100 },
    p3: { x: 50, y: 80 },
    p4: { x: 150, y: 80 },
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

    // 1) Update a weak annotation FIRST. Update is non-invalidating
    //    (no revision bump, no index shift), so any index refs we
    //    captured stay valid for the rest of the demo. We exercise
    //    update first specifically to demonstrate the opportunistic
    //    UUID v4 /NM stamp on a weak annotation; the resulting ref
    //    will be upgraded to `kind: 'nm'`.
    //
    //    (Note: `create` is also non-invalidating now — append-only,
    //    no revision bump — so the historical concern about "create
    //    invalidates `weak.ref`" no longer applies. We still keep the
    //    update-first ordering for narrative clarity in the demo
    //    output.)
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

    // 2) Create two new highlights. Always durable (engine uses
    //    EPDFPage_CreateAnnot, which produces an indirect object).
    const createdA = await page.annotations.create({
      subtype: 'highlight',
      contents: 'mutation demo: A',
      author: 'mutations-demo',
      color: { r: 30, g: 144, b: 255 },
      opacity: 0.4,
      quadPoints: QUAD,
    });
    const createdB = await page.annotations.create({
      subtype: 'highlight',
      contents: 'mutation demo: B',
      author: 'mutations-demo',
      color: { r: 255, g: 99, b: 71 },
      opacity: 0.4,
      quadPoints: QUAD,
    });

    // 3) Single-annotation move: move B to position 0. This exercises
    //    `move([ref], toIndex)` as the single-as-batch case. Move is
    //    index-shifting, so this DOES bump the per-page revision.
    const movedSingle = await page.annotations.move([createdB.created.ref], 0);

    // 4) Multi-block move: move [A, B] to position 0 in caller order.
    //    Verifies that caller-supplied order is preserved at the
    //    destination, ONE revision bump per batch.
    const movedBatch = await page.annotations.move([createdA.created.ref, createdB.created.ref], 0);

    // 5) Delete both annotations we created so the fixture is unchanged.
    //    Use the still-stable durable refs (objectNumber survives
    //    arbitrary moves; that's the whole point of stable identity).
    const deletedA = await page.annotations.delete(createdA.created.ref);
    const deletedB = await page.annotations.delete(createdB.created.ref);

    const after = await page.annotations.list();

    return {
      label,
      docId: doc.id,
      elapsedMs: Date.now() - started,
      before,
      createdA,
      createdB,
      updated,
      movedSingle,
      movedBatch,
      deletedA,
      deletedB,
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
      hasWeak: knownWeakFlag(result.before.pageState),
      count: result.before.annotations.length,
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
    createA: {
      ref: refSummary(result.createdA.created.ref),
      identityQuality: result.createdA.created.identityQuality,
      meta: metaSummary(result.createdA.meta),
    },
    createB: {
      ref: refSummary(result.createdB.created.ref),
      identityQuality: result.createdB.created.identityQuality,
      meta: metaSummary(result.createdB.meta),
    },
    moveSingle: {
      moved: result.movedSingle.moved.map((d) => refSummary(d.ref)),
      meta: metaSummary(result.movedSingle.meta),
    },
    moveBatch: {
      moved: result.movedBatch.moved.map((d) => refSummary(d.ref)),
      meta: metaSummary(result.movedBatch.meta),
    },
    deleteA: {
      deleted: result.deletedA.deleted,
      meta: metaSummary(result.deletedA.meta),
    },
    deleteB: {
      deleted: result.deletedB.deleted,
      meta: metaSummary(result.deletedB.meta),
    },
    after: {
      generation: result.after.pageState.revision.generation,
      hasWeak: knownWeakFlag(result.after.pageState),
      count: result.after.annotations.length,
    },
  };
}

function refSummary(ref: AnnotationRef): string {
  switch (ref.kind) {
    case 'objectNumber':
      return `objectNumber=${ref.annotObjectNumber}`;
    case 'nm':
      return `nm=${ref.nm}`;
    case 'index':
      return `index=${ref.index}`;
    default:
      return exhaustiveRef(ref);
  }
}

function exhaustiveRef(ref: never): string {
  return String(ref);
}

function metaSummary(meta: AnnotationCreateResult['meta']) {
  const pageState = meta.affectedPages[0];
  return {
    generation: pageState?.revision.generation ?? null,
    weakRefsInvalidated: meta.weakRefsInvalidated,
    shouldRefetch: meta.shouldRefetch?.reason ?? null,
    changed: meta.changed.map((c) => `${c.kind}=${String(c.value)}`),
    cacheDelta: meta.cacheDelta
      ? {
          previousDocVersion: meta.cacheDelta.previousDocVersion,
          docVersion: meta.cacheDelta.docVersion,
          pages: meta.cacheDelta.pages.length,
        }
      : null,
  };
}

function knownWeakFlag(pageState: AnnotationListPageSnapshot['pageState']): boolean | null {
  return pageState.weakAnnotationState.kind === 'known'
    ? pageState.weakAnnotationState.hasAnyWeakAnnotations
    : null;
}
