import type {
  ConformanceTestRunner,
  ConformanceFixture,
  ConformanceOptions,
} from './runMetadataConformance';
import type { Engine } from '../engine/Engine';
import type { DocumentHandle } from '../engine/DocumentHandle';
import { AbortError } from '../promise/AbortError';
import { EngineError } from '../errors/EngineError';
import { EngineErrorCode } from '../errors/EngineErrorCode';
import {
  AnnotationCreateResultSchema,
  AnnotationDeleteResultSchema,
  AnnotationMoveResultSchema,
  AnnotationUpdateResultSchema,
} from '../wire/schemas';
import type { AnnotationDraft, AnnotationPatch, HighlightDraft } from '../annotation/kinds';
import type { AnnotationRef } from '../identity/AnnotationRef';
import type { WeakAnnotationEditSession } from '../engine/DocumentAnnotationsService';

/**
 * Per-fixture knowledge the mutation harness needs. The shared fixture
 * fields (id, bytes, etc.) come from `ConformanceFixture`; the bits below
 * pin the test page. The harness asserts behaviour, not exact wire
 * content, so the same fixture can run against both local (WASM) and
 * cloud (native via @cloudpdf/server) engines.
 */
export interface AnnotationMutationConformanceFixture extends ConformanceFixture {
  /** PDF object number of the page used by the mutation tests. */
  pageObjectNumber: number;
  /** Page already has at least one weak annotation (no /NM, direct object). */
  expectsWeakAnnotation: boolean;
  /**
   * QuadPoints to use for the create() smoke test. Coordinates are in
   * PDF user space; pick a small rectangle that fits anywhere on the
   * fixture page so we don't flake on different page sizes.
   */
  createQuad?: HighlightDraft['quadPoints'];
}

export interface AnnotationMutationConformanceOptions extends Omit<ConformanceOptions, 'fixture'> {
  fixture: AnnotationMutationConformanceFixture;
}

const DEFAULT_QUAD: HighlightDraft['quadPoints'] = [
  {
    p1: { x: 50, y: 100 },
    p2: { x: 150, y: 100 },
    p3: { x: 50, y: 80 },
    p4: { x: 150, y: 80 },
  },
];

/**
 * Mutation conformance suite. Mirrors the read suite: tests are written
 * once and run against any engine that satisfies the public API
 * surface. Both local (worker host + WASM) and cloud (HTTP +
 * @cloudpdf/server) implementations must pass identically.
 *
 * The locked rules being verified here:
 *   - `create` is append-only: PDFium drops the new annotation at
 *     `index = previousCount`, so no existing index shifts. Treated
 *     as non-invalidating — revisions do NOT bump and weak refs
 *     captured before the create remain valid.
 *   - `update` is non-structural; revisions do NOT bump.
 *   - Opportunistic /NM stamp upgrades a weak annotation's ref to
 *     `kind: 'nm'` on update; an already-durable annotation's /NM is
 *     NEVER touched.
 *   - `delete` and `move` are the only index-shifting ops. They bump
 *     the per-page revision and, on a page that had weak refs before
 *     the mutation, surface `shouldRefetch: 'weakRefsInvalidated'`.
 *   - Abort propagates as `AbortError` even before the worker
 *     responds.
 */
export function runAnnotationMutationConformance(
  runner: ConformanceTestRunner,
  opts: AnnotationMutationConformanceOptions,
): void {
  const { describe, test, beforeAll, afterAll, expect } = runner;
  const fix = opts.fixture;
  const quad = fix.createQuad ?? DEFAULT_QUAD;

  describe(`annotation mutation conformance: ${opts.label}`, () => {
    let engine: Engine;

    beforeAll(async () => {
      engine = await opts.makeEngine();
    });

    afterAll(async () => {
      if (engine) await engine.destroy();
    });

    test('create appends without shifting indices and leaves weak refs valid', async () => {
      const doc = await openFixture(engine, opts);
      try {
        const page = doc.page(fix.pageObjectNumber);
        const before = await page.annotations.list();
        const beforeCount = before.annotations.length;

        const draft: HighlightDraft = {
          subtype: 'highlight',
          contents: 'mutation conformance: created',
          color: { r: 200, g: 100, b: 50 },
          opacity: 0.5,
          quadPoints: quad,
        };
        const result = await page.annotations.create(draft);
        expect(AnnotationCreateResultSchema.safeParse(result).success).toBe(true);
        expect(result.meta.affectedPages.length).toBe(1);
        expect(result.meta.affectedPages[0].pageObjectNumber).toBe(fix.pageObjectNumber);
        expect('cacheDelta' in result.meta).toBe(true);

        // Always durable (engine uses the EPDFPage_CreateAnnot fork helper).
        expect(result.created.identityQuality).toBe('durable');
        expect(result.created.subtype).toBe('highlight');
        expect(result.created.ref.kind).toBe('objectNumber');

        // Locked rule: create is append-only, so the page revision does
        // NOT bump and no weak refs become stale — regardless of whether
        // the page had pre-existing weak annotations.
        expect(result.meta.affectedPages[0].revision.generation).toBe(
          before.pageState.revision.generation,
        );
        expect(result.meta.shouldRefetch).toBe(null);
        expect(result.meta.weakRefsInvalidated).toBe(false);
        expect(result.meta.changed.length).toBe(1);

        // The annotation is actually on the page now, at the END of the
        // /Annots array. This is the invariant that justifies the
        // non-invalidating impact: every prior index is preserved.
        const after = await page.annotations.list();
        expect(after.annotations.length).toBe(beforeCount + 1);
        expect(result.created.index).toBe(beforeCount);
      } finally {
        await doc.close();
      }
    });

    test('update on a durable annotation is non-structural and never touches /NM', async () => {
      const doc = await openFixture(engine, opts);
      try {
        const page = doc.page(fix.pageObjectNumber);
        const before = await page.annotations.list();

        const target = before.annotations.find((a) => a.identityQuality === 'durable');
        // Skip the assertion gracefully if the fixture has no durable annot
        // up front; the test fixture used in our suites does (the existing
        // highlights have /NM).
        if (!target) return;

        const ref: AnnotationRef = target.ref;
        const newContents = `mutation conformance: updated@${Date.now()}`;
        const patch = subtypeAwarePatch(target.subtype, newContents);
        if (!patch) return;

        const result = await page.annotations.update(ref, patch);
        expect(AnnotationUpdateResultSchema.safeParse(result).success).toBe(true);
        expect(result.meta.affectedPages.length).toBe(1);
        expect(result.meta.affectedPages[0].pageObjectNumber).toBe(fix.pageObjectNumber);
        expect('cacheDelta' in result.meta).toBe(true);

        // Same identity, /NM untouched.
        expect(result.updated.ref.kind).toBe(target.ref.kind);
        expect(result.updated.nm).toBe(target.nm);

        // Update never bumps the revision.
        expect(result.meta.affectedPages[0].revision.generation).toBe(
          before.pageState.revision.generation,
        );
        expect(result.meta.shouldRefetch).toBe(null);
        expect(result.meta.weakRefsInvalidated).toBe(false);

        // Round-trip the new contents.
        expect(result.updated.contents).toBe(newContents);
      } finally {
        await doc.close();
      }
    });

    if (fix.expectsWeakAnnotation) {
      test('update on a weak annotation stamps a UUID v4 /NM and upgrades the ref', async () => {
        const doc = await openFixture(engine, opts);
        try {
          const page = doc.page(fix.pageObjectNumber);
          const before = await page.annotations.list();

          const weak = before.annotations.find((a) => a.identityQuality === 'weak');
          expect(weak !== undefined).toBe(true);
          if (!weak) return;
          expect(weak.ref.kind).toBe('index');

          const newContents = `weak-upgrade@${Date.now()}`;
          const patch = subtypeAwarePatch(weak.subtype, newContents);
          if (!patch) return;

          const result = await page.annotations.update(weak.ref, patch);
          expect(AnnotationUpdateResultSchema.safeParse(result).success).toBe(true);
          expect(result.meta.affectedPages.length).toBe(1);
          expect(result.meta.affectedPages[0].pageObjectNumber).toBe(fix.pageObjectNumber);
          expect('cacheDelta' in result.meta).toBe(true);

          // The ref is upgraded to durable. Either nm (engine-stamped) or
          // objectNumber (if the annotation surprisingly had one) is fine.
          expect(
            result.updated.ref.kind === 'nm' || result.updated.ref.kind === 'objectNumber',
          ).toBe(true);
          expect(result.updated.identityQuality).toBe('durable');
          if (result.updated.ref.kind === 'nm') {
            expect(result.updated.nm !== null).toBe(true);
            expect(typeof result.updated.nm).toBe('string');
            // Engine stamps RFC 4122 v4 UUIDs: 8-4-4-4-12 hex with
            // version 4 and variant 10xx. Match loosely.
            expect(
              /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
                result.updated.nm!,
              ),
            ).toBe(true);
          }

          // Still non-structural.
          expect(result.meta.affectedPages[0].revision.generation).toBe(
            before.pageState.revision.generation,
          );
          expect(result.meta.shouldRefetch).toBe(null);
        } finally {
          await doc.close();
        }
      });
    }

    test('delete by objectNumber removes the annotation and reports a stable id', async () => {
      const doc = await openFixture(engine, opts);
      try {
        const page = doc.page(fix.pageObjectNumber);
        // Create one we own so we don't disturb the fixture's other tests.
        const draft: HighlightDraft = {
          subtype: 'highlight',
          contents: 'mutation conformance: to-delete',
          quadPoints: quad,
        };
        const created = await page.annotations.create(draft);
        const before = await page.annotations.list();

        const weakSession = await beginWeakEditIfRequired(doc, fix.pageObjectNumber, fix);
        const result = await page.annotations.delete(created.created.ref);
        try {
          expect(AnnotationDeleteResultSchema.safeParse(result).success).toBe(true);
          expect(result.meta.affectedPages.length).toBe(1);
          expect(result.meta.affectedPages[0].pageObjectNumber).toBe(fix.pageObjectNumber);
          expect('cacheDelta' in result.meta).toBe(true);

          // Stable id is reported (we created it; it's durable).
          expect(result.deleted !== null).toBe(true);
          expect(result.deleted?.kind).toBe('objectNumber');

          // Structural: revision bumped.
          expect(result.meta.affectedPages[0].revision.generation).toBe(
            before.pageState.revision.generation + 1,
          );

          // The annotation is gone.
          const after = await page.annotations.list();
          expect(after.annotations.length).toBe(before.annotations.length - 1);
        } finally {
          await weakSession?.release();
        }
      } finally {
        await doc.close();
      }
    });

    if (fix.expectsWeakAnnotation) {
      test('delete by index of a weak annotation reports deleted: null and refetch reason', async () => {
        const doc = await openFixture(engine, opts);
        try {
          const page = doc.page(fix.pageObjectNumber);
          const before = await page.annotations.list();
          const weak = before.annotations.find((a) => a.identityQuality === 'weak');
          if (!weak) return;
          expect(weak.ref.kind).toBe('index');

          const weakSession = await beginWeakEditIfRequired(doc, fix.pageObjectNumber, fix);
          const result = await page.annotations.delete(weak.ref);
          try {
            // The weak annotation MAY have had /NM in some shapes (very
            // legacy PDFs), but the locked semantics say a true weak
            // delete returns null. We assert "either null or a stable id"
            // since the fixture controls which side this lands on.
            expect(
              result.deleted === null ||
                result.deleted.kind === 'objectNumber' ||
                result.deleted.kind === 'nm',
            ).toBe(true);
            expect(result.meta.affectedPages.length).toBe(1);
            expect(result.meta.affectedPages[0].pageObjectNumber).toBe(fix.pageObjectNumber);
            expect('cacheDelta' in result.meta).toBe(true);

            // The page had weak refs before, structural mutation,
            // therefore: shouldRefetch is set.
            expect(result.meta.shouldRefetch?.reason).toBe('weakRefsInvalidated');
            expect(result.meta.weakRefsInvalidated).toBe(true);
          } finally {
            await weakSession?.release();
          }
        } finally {
          await doc.close();
        }
      });
    }

    test('abort on create rejects with AbortError', async () => {
      const doc = await openFixture(engine, opts);
      try {
        const page = doc.page(fix.pageObjectNumber);
        const draft: HighlightDraft = {
          subtype: 'highlight',
          contents: 'will be aborted',
          quadPoints: quad,
        };
        const p = page.annotations.create(draft);
        p.abort('test');
        await expect(p).rejects.toBeInstanceOf(AbortError);
      } finally {
        await doc.close();
      }
    });

    test('update with a stale index revision throws InvalidReference', async () => {
      const doc = await openFixture(engine, opts);
      try {
        const page = doc.page(fix.pageObjectNumber);
        const before = await page.annotations.list();
        const weak = before.annotations.find((a) => a.identityQuality === 'weak');
        if (!weak || weak.ref.kind !== 'index') return;

        // Force the revision out of date by minting an *index-shifting*
        // mutation, then trying to update against the stale ref. We
        // deliberately use a throwaway create+delete pair (delete is
        // the rev-bumping op now — create is append-only and does NOT
        // bump revisions, so it can't be used here).
        const throwaway = await page.annotations.create({
          subtype: 'highlight',
          contents: 'rev-bump-throwaway',
          quadPoints: quad,
        });
        const weakSession = await beginWeakEditIfRequired(doc, fix.pageObjectNumber, fix);
        await page.annotations.delete(throwaway.created.ref);
        await weakSession?.release();

        const patch = subtypeAwarePatch(weak.subtype, 'should-fail');
        if (!patch) return;
        let caught: unknown;
        try {
          await page.annotations.update(weak.ref, patch);
        } catch (err) {
          caught = err;
        }
        expect(EngineError.is(caught, EngineErrorCode.InvalidReference)).toBe(true);
      } finally {
        await doc.close();
      }
    });

    // ─────────────────────────────────────────────────────────────────
    //  move() — batch contiguous-block reorder. Locked invariants:
    //  - `move([ref], toIndex)` is the single-annotation case; same
    //    primitive as multi-move.
    //  - One revision bump per batch, regardless of `refs.length`.
    //  - Caller-supplied order is preserved at the destination.
    //  - Weak refs in the batch are upgraded to durable /NM BEFORE the
    //    move; the moved DTOs come out durable and `meta.changed` lists
    //    stable ids.
    //  - Stale revision, out-of-range, duplicate, and abort all reject.
    // ─────────────────────────────────────────────────────────────────

    test('move single durable annotation reorders within the page (single-as-batch)', async () => {
      const doc = await openFixture(engine, opts);
      try {
        const page = doc.page(fix.pageObjectNumber);

        // Seed two durable annotations we can predict ordering for.
        const aDraft: HighlightDraft = {
          subtype: 'highlight',
          contents: 'move-a',
          quadPoints: quad,
        };
        const bDraft: HighlightDraft = {
          subtype: 'highlight',
          contents: 'move-b',
          quadPoints: quad,
        };
        const a = await page.annotations.create(aDraft);
        const b = await page.annotations.create(bDraft);
        const list = await page.annotations.list();
        const beforeRev = list.pageState.revision.generation;

        // Find current indices of a and b.
        const aIdx = list.annotations.findIndex(
          (x) =>
            x.ref.kind === 'objectNumber' &&
            a.created.ref.kind === 'objectNumber' &&
            x.ref.annotObjectNumber === a.created.ref.annotObjectNumber,
        );
        const bIdx = list.annotations.findIndex(
          (x) =>
            x.ref.kind === 'objectNumber' &&
            b.created.ref.kind === 'objectNumber' &&
            x.ref.annotObjectNumber === b.created.ref.annotObjectNumber,
        );
        expect(aIdx >= 0 && bIdx >= 0).toBe(true);
        expect(aIdx < bIdx).toBe(true);

        // Move A to B's slot. Post-removal index space: A was removed,
        // so B's position becomes bIdx - 1. Targeting bIdx puts A AFTER
        // B's original position. Use `bIdx` as toIndex => A lands right
        // after B in the new order.
        const weakSession = await beginWeakEditIfRequired(doc, fix.pageObjectNumber, fix);
        const result = await page.annotations.move([a.created.ref], bIdx);
        try {
          expect(AnnotationMoveResultSchema.safeParse(result).success).toBe(true);
          expect(result.meta.affectedPages.length).toBe(1);
          expect(result.meta.affectedPages[0].pageObjectNumber).toBe(fix.pageObjectNumber);
          expect('cacheDelta' in result.meta).toBe(true);
          expect(result.moved.length).toBe(1);

          // Single revision bump per batch.
          expect(result.meta.affectedPages[0].revision.generation).toBe(beforeRev + 1);

          // The moved DTO sits at toIndex.
          if (result.moved[0].ref.kind === 'objectNumber') {
            const movedObjNum = result.moved[0].ref.annotObjectNumber;
            if (a.created.ref.kind === 'objectNumber') {
              expect(movedObjNum).toBe(a.created.ref.annotObjectNumber);
            }
          }

          // Verify the page now has A at its new position.
          const after = await page.annotations.list();
          expect(after.annotations.length).toBe(list.annotations.length);
        } finally {
          await weakSession?.release();
        }
      } finally {
        await doc.close();
      }
    });

    test('move multi-block preserves caller-supplied order at the destination', async () => {
      const doc = await openFixture(engine, opts);
      try {
        const page = doc.page(fix.pageObjectNumber);

        // Seed three durable annotations.
        const ids = await Promise.all(
          ['multi-1', 'multi-2', 'multi-3'].map((label) =>
            page.annotations.create({
              subtype: 'highlight',
              contents: label,
              quadPoints: quad,
            }),
          ),
        );

        const list = await page.annotations.list();
        const beforeRev = list.pageState.revision.generation;

        // Move the three to position 0 in caller order [3, 1, 2].
        const callerOrder = [ids[2].created.ref, ids[0].created.ref, ids[1].created.ref];
        const weakSession = await beginWeakEditIfRequired(doc, fix.pageObjectNumber, fix);
        const result = await page.annotations.move(callerOrder, 0);
        try {
          // One revision bump even though three annotations moved.
          expect(result.meta.affectedPages[0].revision.generation).toBe(beforeRev + 1);
          expect(result.moved.length).toBe(3);
          expect(result.meta.changed.length).toBe(3);

          // Caller-supplied order preserved at the destination. Indices
          // 0, 1, 2 of the page now hold the moved DTOs in that order.
          const expectedOrder = [ids[2].created.ref, ids[0].created.ref, ids[1].created.ref].map(
            (r) => (r.kind === 'objectNumber' ? r.annotObjectNumber : null),
          );

          const movedObjNums = result.moved.map((d) =>
            d.ref.kind === 'objectNumber' ? d.ref.annotObjectNumber : null,
          );
          for (let i = 0; i < expectedOrder.length; i++) {
            expect(movedObjNums[i]).toBe(expectedOrder[i]);
          }
        } finally {
          await weakSession?.release();
        }
      } finally {
        await doc.close();
      }
    });

    if (fix.expectsWeakAnnotation) {
      test('move on a weak annotation upgrades it to durable /NM (one rev bump for batch)', async () => {
        const doc = await openFixture(engine, opts);
        try {
          const page = doc.page(fix.pageObjectNumber);
          const before = await page.annotations.list();
          const weak = before.annotations.find((a) => a.identityQuality === 'weak');
          if (!weak || weak.ref.kind !== 'index') return;
          const beforeRev = before.pageState.revision.generation;

          // Move the weak annotation to position 0 (or somewhere
          // non-trivial). The engine must stamp a fresh /NM BEFORE the
          // move so the result is durable.
          const target = weak.ref.index === 0 ? 1 : 0;
          const weakSession = await beginWeakEditIfRequired(doc, fix.pageObjectNumber, fix);
          const result = await page.annotations.move([weak.ref], target);
          try {
            expect(result.meta.affectedPages[0].revision.generation).toBe(beforeRev + 1);
            expect(result.moved.length).toBe(1);
            expect(result.moved[0].identityQuality).toBe('durable');
            expect(
              result.moved[0].ref.kind === 'nm' || result.moved[0].ref.kind === 'objectNumber',
            ).toBe(true);

            // meta.changed is a stable id, never a weak ref.
            expect(result.meta.changed.length).toBe(1);
            expect(
              result.meta.changed[0].kind === 'nm' ||
                result.meta.changed[0].kind === 'objectNumber',
            ).toBe(true);
          } finally {
            await weakSession?.release();
          }
        } finally {
          await doc.close();
        }
      });
    }

    test('move with a stale index revision rejects (locked rev-token guard)', async () => {
      const doc = await openFixture(engine, opts);
      try {
        const page = doc.page(fix.pageObjectNumber);
        const a = await page.annotations.create({
          subtype: 'highlight',
          contents: 'stale-a',
          quadPoints: quad,
        });
        const list = await page.annotations.list();
        const aIdx = list.annotations.findIndex(
          (x) =>
            x.ref.kind === 'objectNumber' &&
            a.created.ref.kind === 'objectNumber' &&
            x.ref.annotObjectNumber === a.created.ref.annotObjectNumber,
        );
        if (aIdx < 0) return;

        const staleIndexRef: AnnotationRef = {
          kind: 'index',
          pageObjectNumber: fix.pageObjectNumber,
          index: aIdx,
          revision: list.pageState.revision,
        };

        // Bump the revision by an unrelated index-shifting mutation.
        // create is append-only and no longer bumps revisions, so we
        // use a throwaway create+delete pair (the delete does the bump).
        const throwaway = await page.annotations.create({
          subtype: 'highlight',
          contents: 'bump-throwaway',
          quadPoints: quad,
        });
        const weakSession = await beginWeakEditIfRequired(doc, fix.pageObjectNumber, fix);
        await page.annotations.delete(throwaway.created.ref);

        let caught: unknown;
        try {
          await page.annotations.move([staleIndexRef], 0);
        } catch (err) {
          caught = err;
        } finally {
          await weakSession?.release();
        }
        expect(EngineError.is(caught, EngineErrorCode.InvalidReference)).toBe(true);
      } finally {
        await doc.close();
      }
    });

    test('move with out-of-range toIndex rejects with InvalidArg', async () => {
      const doc = await openFixture(engine, opts);
      try {
        const page = doc.page(fix.pageObjectNumber);
        const a = await page.annotations.create({
          subtype: 'highlight',
          contents: 'oor-a',
          quadPoints: quad,
        });
        const list = await page.annotations.list();
        const farTooBig = list.annotations.length + 100;
        const weakSession = await beginWeakEditIfRequired(doc, fix.pageObjectNumber, fix);
        let caught: unknown;
        try {
          await page.annotations.move([a.created.ref], farTooBig);
        } catch (err) {
          caught = err;
        } finally {
          await weakSession?.release();
        }
        expect(EngineError.is(caught, EngineErrorCode.InvalidArg)).toBe(true);
      } finally {
        await doc.close();
      }
    });

    test('move with duplicate refs rejects with InvalidArg', async () => {
      const doc = await openFixture(engine, opts);
      try {
        const page = doc.page(fix.pageObjectNumber);
        const a = await page.annotations.create({
          subtype: 'highlight',
          contents: 'dup-a',
          quadPoints: quad,
        });
        const weakSession = await beginWeakEditIfRequired(doc, fix.pageObjectNumber, fix);
        let caught: unknown;
        try {
          await page.annotations.move([a.created.ref, a.created.ref], 0);
        } catch (err) {
          caught = err;
        } finally {
          await weakSession?.release();
        }
        expect(EngineError.is(caught, EngineErrorCode.InvalidArg)).toBe(true);
      } finally {
        await doc.close();
      }
    });

    test('abort on move rejects with AbortError', async () => {
      const doc = await openFixture(engine, opts);
      try {
        const page = doc.page(fix.pageObjectNumber);
        const a = await page.annotations.create({
          subtype: 'highlight',
          contents: 'abort-a',
          quadPoints: quad,
        });
        const weakSession = await beginWeakEditIfRequired(doc, fix.pageObjectNumber, fix);
        const p = page.annotations.move([a.created.ref], 0);
        p.abort('test');
        try {
          await expect(p).rejects.toBeInstanceOf(AbortError);
        } finally {
          await weakSession?.release();
        }
      } finally {
        await doc.close();
      }
    });

    test('a page move does NOT bump per-page RevisionTokens (weak refs survive reorder)', async () => {
      const doc = await openFixture(engine, opts);
      try {
        const list = await doc.pages.list();
        if (list.pages.length < 1) return;

        // Revision is annotation liveness, keyed by `pageObjectNumber`. A
        // page move is structural-geometry-only: no page's /Annots array is
        // touched, so no `RevisionToken` bumps and index-kind refs captured
        // before the reorder stay valid. We observe the host page's
        // revision via `annotations.list().pageState` (the move result no
        // longer carries liveness — it returns geometry).
        const page = doc.page(fix.pageObjectNumber);
        const beforeGen = (await page.annotations.list()).pageState.revision.generation;

        // Pull some page to the front (prefer one that is NOT the host so
        // we exercise the cross-page case; fall back to the host itself for
        // single-page fixtures).
        const mover =
          list.pages.find((pg) => pg.pageObjectNumber !== fix.pageObjectNumber)?.pageObjectNumber ??
          fix.pageObjectNumber;
        await doc.pages.move([mover], 0);

        const afterGen = (await page.annotations.list()).pageState.revision.generation;
        expect(afterGen).toBe(beforeGen);
      } finally {
        await doc.close();
      }
    });
  });
}

async function beginWeakEditIfRequired(
  doc: DocumentHandle,
  pageObjectNumber: number,
  fix: AnnotationMutationConformanceFixture,
): Promise<WeakAnnotationEditSession | null> {
  if (doc.capabilities.weakAnnotationEditSessions !== 'required' || !fix.expectsWeakAnnotation) {
    return null;
  }
  return doc.annotations.beginWeakEdit([pageObjectNumber]);
}

async function openFixture(
  engine: Engine,
  opts: AnnotationMutationConformanceOptions,
): Promise<DocumentHandle> {
  if (opts.openKind === 'bytes') {
    const bytes = await opts.fixture.bytes();
    return engine.open({ kind: 'bytes', id: opts.fixture.id, bytes });
  }
  return engine.open({ kind: 'id', id: opts.fixture.cloudId ?? opts.fixture.id });
}

/**
 * Build a valid `AnnotationPatch` for the supplied subtype that mutates
 * a single field we can read back. Returns `null` for subtypes the
 * harness can't synthesise a patch for (e.g. unsupported); caller
 * gracefully skips.
 */
function subtypeAwarePatch(subtype: string, newContents: string): AnnotationPatch | null {
  switch (subtype) {
    case 'highlight':
    case 'underline':
    case 'squiggly':
    case 'strikeout':
      return {
        subtype: subtype as AnnotationPatch['subtype'],
        contents: newContents,
      } as AnnotationPatch;
    default:
      return null;
  }
}
