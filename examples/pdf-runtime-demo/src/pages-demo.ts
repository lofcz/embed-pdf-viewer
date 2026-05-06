import type { Engine, PageListSnapshot, PageMoveResult } from '@embedpdf/engine-core';

/**
 * Engine-agnostic page-reorder walkthrough. Drives `pages.list()`,
 * one single-page move, and one multi-page contiguous-block move. The
 * walkthrough then re-asserts the locked invariants:
 *
 *   - `pages.list()` reports every page in display order, with durable
 *     PONs and dense `pageIndex`.
 *   - Per-page `RevisionToken`s do NOT bump on a page move (this is
 *     the cornerstone of the "weak-ref survives reorder" semantic).
 *   - Set of PONs is preserved across the move (no page lost or
 *     fabricated).
 *
 * Returns the observable side-effects so the node + browser entries
 * can render the same payload.
 */
export interface PagesDemoResult {
  label: string;
  docId: string;
  elapsedMs: number;
  before: PageListSnapshot;
  movedSingle: PageMoveResult;
  movedBatch: PageMoveResult;
  after: PageListSnapshot;
  /** Computed for the summary; true means the locked invariants held. */
  invariants: {
    revisionsUnchanged: boolean;
    ponSetPreserved: boolean;
    indicesDense: boolean;
  };
}

export async function runPagesDemo(
  label: string,
  engine: Engine,
  pdfBytes: Uint8Array,
  docId = `pages-demo-${label}`,
): Promise<PagesDemoResult> {
  const started = Date.now();
  const doc = await engine.open({ kind: 'bytes', id: docId, bytes: pdfBytes });
  try {
    const before = await doc.pages.list();
    if (before.pages.length < 2) {
      throw new Error(`pages demo requires at least 2 pages; fixture has ${before.pages.length}`);
    }

    // Capture every page's revision generation BEFORE the moves so we
    // can assert they survive the reorder unchanged.
    const beforeRevByPon = new Map<number, number>();
    for (const p of before.pages) beforeRevByPon.set(p.pageObjectNumber, p.revision.generation);

    // 1) Single-page move: send the LAST page to the FRONT.
    const lastPon = before.pages[before.pages.length - 1].pageObjectNumber;
    const movedSingle = await doc.pages.move([lastPon], 0);

    // 2) Multi-page contiguous-block move: send pages [0, 1] (post-
    //    single-move order) to the END. Mirrors `FPDF_MovePages`
    //    semantics — the block is detached and re-inserted at the
    //    destination in the post-removal index space, preserving
    //    caller order.
    if (movedSingle.pageOrder.length >= 3) {
      const block = [
        movedSingle.pageOrder[0].pageObjectNumber,
        movedSingle.pageOrder[1].pageObjectNumber,
      ];
      const dest = movedSingle.pageOrder.length - block.length;
      const movedBatch = await doc.pages.move(block, dest);
      const after = await doc.pages.list();

      const invariants = computeInvariants(beforeRevByPon, before, after);
      return {
        label,
        docId: doc.id,
        elapsedMs: Date.now() - started,
        before,
        movedSingle,
        movedBatch,
        after,
        invariants,
      };
    }

    // <3 pages — report the single-move twice so the demo is still
    // observable without crashing.
    const after = await doc.pages.list();
    const invariants = computeInvariants(beforeRevByPon, before, after);
    return {
      label,
      docId: doc.id,
      elapsedMs: Date.now() - started,
      before,
      movedSingle,
      movedBatch: movedSingle,
      after,
      invariants,
    };
  } finally {
    await doc.close();
  }
}

function computeInvariants(
  beforeRevByPon: Map<number, number>,
  before: PageListSnapshot,
  after: PageListSnapshot,
): PagesDemoResult['invariants'] {
  let revisionsUnchanged = true;
  for (const p of after.pages) {
    if (beforeRevByPon.get(p.pageObjectNumber) !== p.revision.generation) {
      revisionsUnchanged = false;
      break;
    }
  }
  const beforePons = new Set(before.pages.map((p) => p.pageObjectNumber));
  const afterPons = new Set(after.pages.map((p) => p.pageObjectNumber));
  let ponSetPreserved = beforePons.size === afterPons.size;
  if (ponSetPreserved) {
    for (const pon of beforePons) {
      if (!afterPons.has(pon)) {
        ponSetPreserved = false;
        break;
      }
    }
  }
  let indicesDense = true;
  for (let i = 0; i < after.pages.length; i++) {
    if (after.pages[i].pageIndex !== i) {
      indicesDense = false;
      break;
    }
  }
  return { revisionsUnchanged, ponSetPreserved, indicesDense };
}

export function summarizePages(result: PagesDemoResult) {
  return {
    label: result.label,
    docId: result.docId,
    elapsedMs: result.elapsedMs,
    before: result.before.pages.map((p) => ({
      pon: p.pageObjectNumber,
      idx: p.pageIndex,
      gen: p.revision.generation,
    })),
    movedSingle: result.movedSingle.pageOrder.map((p) => ({
      pon: p.pageObjectNumber,
      idx: p.pageIndex,
      gen: p.revision.generation,
    })),
    movedBatch: result.movedBatch.pageOrder.map((p) => ({
      pon: p.pageObjectNumber,
      idx: p.pageIndex,
      gen: p.revision.generation,
    })),
    after: result.after.pages.map((p) => ({
      pon: p.pageObjectNumber,
      idx: p.pageIndex,
      gen: p.revision.generation,
    })),
    invariants: result.invariants,
  };
}
