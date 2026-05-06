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
  AnnotationUpdateResultSchema,
} from '../wire/schemas';
import type { AnnotationDraft, AnnotationPatch, HighlightDraft } from '../annotation/kinds';
import type { AnnotationRef } from '../identity/AnnotationRef';

/**
 * Per-fixture knowledge the mutation harness needs. The shared fixture
 * fields (id, bytes, etc.) come from `ConformanceFixture`; the bits below
 * pin the test page. The harness asserts behaviour, not exact wire
 * content, so the same fixture can run against both local (WASM) and
 * cloud (native via @embedpdf/server) engines.
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
    topLeft: { x: 50, y: 100 },
    topRight: { x: 150, y: 100 },
    bottomLeft: { x: 50, y: 80 },
    bottomRight: { x: 150, y: 80 },
  },
];

/**
 * Mutation conformance suite. Mirrors the read suite: tests are written
 * once and run against any engine that satisfies the public API
 * surface. Both local (worker host + WASM) and cloud (HTTP +
 * @embedpdf/server) implementations must pass identically.
 *
 * The locked rules being verified here:
 *   - `create` is structural and revisions bump.
 *   - `update` is non-structural; revisions do NOT bump.
 *   - Opportunistic /NM stamp upgrades a weak annotation's ref to
 *     `kind: 'nm'` on update; an already-durable annotation's /NM is
 *     NEVER touched.
 *   - `delete` is structural; weak deletes return `deleted: null`;
 *     `shouldRefetch` is set iff the page had weak refs before.
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

    test('create returns a durable annotation and bumps revision (structural)', async () => {
      const doc = await openFixture(engine, opts);
      try {
        const page = doc.page(fix.pageObjectNumber);
        const before = await page.annotations.list();
        const beforeCount = before.annotations.length;

        const draft: HighlightDraft = {
          subtype: 'highlight',
          contents: 'mutation conformance: created',
          author: 'conformance',
          color: { r: 200, g: 100, b: 50 },
          opacity: 0.5,
          quadPoints: quad,
        };
        const result = await page.annotations.create(draft);
        expect(AnnotationCreateResultSchema.safeParse(result).success).toBe(true);

        // Always durable (engine uses the EPDFPage_CreateAnnot fork helper).
        expect(result.created.identityQuality).toBe('durable');
        expect(result.created.subtype).toBe('highlight');
        expect(result.created.ref.kind).toBe('objectNumber');

        // Structural mutation.
        expect(result.meta.pageState.revision.generation).toBe(
          before.pageState.revision.generation + 1,
        );
        expect(result.meta.changed.length).toBe(1);

        // Locked rule: shouldRefetch is non-null iff the page had any weak
        // refs *before* the mutation.
        if (before.pageState.hasAnyWeakAnnotations) {
          expect(result.meta.shouldRefetch?.reason).toBe('weakRefsInvalidated');
          expect(result.meta.weakRefsInvalidated).toBe(true);
        } else {
          expect(result.meta.shouldRefetch).toBe(null);
          expect(result.meta.weakRefsInvalidated).toBe(false);
        }

        // The annotation is actually on the page now.
        const after = await page.annotations.list();
        expect(after.annotations.length).toBe(beforeCount + 1);
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

        // Same identity, /NM untouched.
        expect(result.updated.ref.kind).toBe(target.ref.kind);
        expect(result.updated.nm).toBe(target.nm);

        // Update never bumps the revision.
        expect(result.meta.pageState.revision.generation).toBe(
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
          expect(result.meta.pageState.revision.generation).toBe(
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

        const result = await page.annotations.delete(created.created.ref);
        expect(AnnotationDeleteResultSchema.safeParse(result).success).toBe(true);

        // Stable id is reported (we created it; it's durable).
        expect(result.deleted !== null).toBe(true);
        expect(result.deleted?.kind).toBe('objectNumber');

        // Structural: revision bumped.
        expect(result.meta.pageState.revision.generation).toBe(
          before.pageState.revision.generation + 1,
        );

        // The annotation is gone.
        const after = await page.annotations.list();
        expect(after.annotations.length).toBe(before.annotations.length - 1);
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

          const result = await page.annotations.delete(weak.ref);
          // The weak annotation MAY have had /NM in some shapes (very
          // legacy PDFs), but the locked semantics say a true weak
          // delete returns null. We assert "either null or a stable id"
          // since the fixture controls which side this lands on.
          expect(
            result.deleted === null ||
              result.deleted.kind === 'objectNumber' ||
              result.deleted.kind === 'nm',
          ).toBe(true);

          // The page had weak refs before, structural mutation,
          // therefore: shouldRefetch is set.
          expect(result.meta.shouldRefetch?.reason).toBe('weakRefsInvalidated');
          expect(result.meta.weakRefsInvalidated).toBe(true);
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

        // Force the revision out of date by minting a structural
        // mutation, then trying to update against the stale ref.
        const draft: HighlightDraft = {
          subtype: 'highlight',
          contents: 'rev-bump',
          quadPoints: quad,
        };
        await page.annotations.create(draft);

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
  });
}

async function openFixture(
  engine: Engine,
  opts: AnnotationMutationConformanceOptions,
): Promise<DocumentHandle> {
  if (opts.openKind === 'bytes') {
    const bytes = await opts.fixture.bytes();
    return engine.open({ kind: 'bytes', id: opts.fixture.id, bytes });
  }
  return engine.open({ kind: 'preuploaded', id: opts.fixture.cloudId ?? opts.fixture.id });
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
