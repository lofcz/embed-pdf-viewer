import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createCloudEngine } from '../src/index';
import { HttpClient } from '../src/transport/HttpClient';
import { CloudDocumentHandle } from '../src/document/CloudDocumentHandle';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core/runtime';
import {
  AnnotationListPageSnapshotSchema,
  DocumentHeadSchema,
  DocumentManifestSchema,
  PageTextSnapshotSchema,
} from '@embedpdf/engine-core/wire';

/**
 * Stub the network so we can drive the manifest pointer's value
 * from the test and observe the SDK's transparent re-fetch + retry.
 *
 * The fixture wires four endpoints:
 *
 *   GET /v1/docs/:docId/head             → current head (`docVersion`)
 *   GET /v1/docs/:docId/v:D/manifest     → current manifest, 404 if `D` ≠ current
 *   GET /v1/docs/:docId/pages/:pon/v:P/text → page text, 404 if `P` ≠ current page contentVersion
 *   (any other path)                     → 404 (so we'd notice spurious calls)
 *
 * The test rewrites the "current" version mid-flight to model a
 * mutation flipping the manifest under the SDK. The retry must:
 *   1. Issue GET with the *stale* `P` (from cached manifest)
 *   2. Receive 404
 *   3. Re-fetch `/head` and the new `/v:D/manifest`
 *   4. Re-issue GET with the *fresh* `P`
 *   5. Return the parsed snapshot
 *
 * If anything escapes that ladder — e.g. the retry uses the same
 * stale URL twice — the request count diverges from the expected
 * `[stale-leaf, head, manifest, fresh-leaf]` sequence and the
 * test fails loudly.
 */
interface ServerState {
  docVersion: number;
  pageContentVersion: number;
  pageAnnotationVersion: number;
  text: string;
}

interface CallLog {
  method: string;
  path: string;
}

interface StubbedFixture {
  http: HttpClient;
  state: ServerState;
  /** Mutate state to simulate the server bumping versions. */
  bump(opts: Partial<ServerState>): void;
  /** Every request that hit the stub, in order. */
  calls: CallLog[];
}

const DOC_ID = 'doc-retry-stub';
const LAYER_NAME = 'default';
const PAGE_OBJECT_NUMBER = 5;

function buildStub(initial: ServerState): StubbedFixture {
  const state: ServerState = { ...initial };
  const calls: CallLog[] = [];

  const stubFetch: typeof globalThis.fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
    const method = init?.method ?? 'GET';
    calls.push({ method, path });

    const headMatch = path.match(/^\/v1\/docs\/([^/]+)\/layers\/([^/]+)\/head$/);
    if (headMatch && method === 'GET') {
      return new Response(
        JSON.stringify({
          id: headMatch[1],
          baseSha: 'stub-sha',
          pageCount: 1,
          storageSizeBytes: 1024,
          docVersion: state.docVersion,
          state: 'ready',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    const manifestMatch = path.match(/^\/v1\/docs\/([^/]+)\/layers\/([^/]+)\/v(\d+)\/manifest$/);
    if (manifestMatch && method === 'GET') {
      const requested = Number(manifestMatch[3]);
      if (requested !== state.docVersion) {
        return new Response(
          JSON.stringify({ error: { code: 'NotFound', message: 'stale docVersion' } }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          docVersion: state.docVersion,
          baseSha: 'stub-sha',
          pages: [
            {
              pageObjectNumber: PAGE_OBJECT_NUMBER,
              pageIndex: 0,
              revision: {
                docSessionId: 'stub-session',
                pageObjectNumber: PAGE_OBJECT_NUMBER,
                generation: 0,
              },
              weakAnnotationState: { kind: 'known', hasAnyWeakAnnotations: false },
              hasAnyWeakAnnotations: false,
              contentVersion: state.pageContentVersion,
              annotationVersion: state.pageAnnotationVersion,
              hasWeakAnnotations: false,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    const textMatch = path.match(
      /^\/v1\/docs\/([^/]+)\/layers\/([^/]+)\/pages\/(\d+)\/v(\d+)\/text$/,
    );
    if (textMatch && method === 'GET') {
      const requestedPon = Number(textMatch[3]);
      const requestedVersion = Number(textMatch[4]);
      if (requestedPon !== PAGE_OBJECT_NUMBER) {
        return new Response(
          JSON.stringify({ error: { code: 'NotFound', message: 'unknown page' } }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        );
      }
      if (requestedVersion !== state.pageContentVersion) {
        return new Response(
          JSON.stringify({ error: { code: 'NotFound', message: 'stale contentVersion' } }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          pageState: {
            pageObjectNumber: PAGE_OBJECT_NUMBER,
            pageIndex: 0,
            revision: {
              docSessionId: 'stub-session',
              pageObjectNumber: PAGE_OBJECT_NUMBER,
              generation: 0,
            },
            weakAnnotationState: { kind: 'known', hasAnyWeakAnnotations: false },
            hasAnyWeakAnnotations: false,
          },
          text: state.text,
          charCount: state.text.length,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    const annotationsMatch = path.match(
      /^\/v1\/docs\/([^/]+)\/layers\/([^/]+)\/pages\/(\d+)\/v(\d+)\/annotations$/,
    );
    if (annotationsMatch && method === 'GET') {
      const requestedPon = Number(annotationsMatch[3]);
      const requestedVersion = Number(annotationsMatch[4]);
      if (requestedPon !== PAGE_OBJECT_NUMBER) {
        return new Response(
          JSON.stringify({ error: { code: 'NotFound', message: 'unknown page' } }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        );
      }
      if (requestedVersion !== state.pageAnnotationVersion) {
        return new Response(
          JSON.stringify({ error: { code: 'NotFound', message: 'stale annotationVersion' } }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          pageState: {
            pageObjectNumber: PAGE_OBJECT_NUMBER,
            pageIndex: 0,
            revision: {
              docSessionId: 'stub-session',
              pageObjectNumber: PAGE_OBJECT_NUMBER,
              generation: 0,
            },
            weakAnnotationState: { kind: 'known', hasAnyWeakAnnotations: false },
            hasAnyWeakAnnotations: false,
          },
          annotations: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ error: { code: 'NotFound', message: `unhandled stub path ${path}` } }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    );
  };

  return {
    http: new HttpClient({
      baseUrl: 'http://stub',
      token: 'stub-token',
      fetch: stubFetch,
    }),
    state,
    bump(opts) {
      Object.assign(state, opts);
    },
    calls,
  };
}

describe('HttpClient.getJsonWithRefresh — transparent stale-version retry', () => {
  test('non-404 errors propagate without triggering refresh', async () => {
    let refreshCalls = 0;
    const stubFetch: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { code: 'Forbidden', message: 'nope' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    const http = new HttpClient({ baseUrl: 'http://stub', token: 'tok', fetch: stubFetch });
    const ctrl = new AbortController();
    await expect(
      http.getJsonWithRefresh(
        async () => '/v1/x',
        (raw) => raw,
        async () => {
          refreshCalls += 1;
        },
        ctrl.signal,
      ),
    ).rejects.toMatchObject({ code: EngineErrorCode.Forbidden });
    expect(refreshCalls).toBe(0);
  });

  test('happy path: no 404, no refresh, exactly one GET', async () => {
    let refreshCalls = 0;
    let getCount = 0;
    const stubFetch: typeof globalThis.fetch = async () => {
      getCount += 1;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const http = new HttpClient({ baseUrl: 'http://stub', token: 'tok', fetch: stubFetch });
    const ctrl = new AbortController();
    const out = await http.getJsonWithRefresh(
      async () => '/v1/x',
      (raw) => raw as { ok: boolean },
      async () => {
        refreshCalls += 1;
      },
      ctrl.signal,
    );
    expect(out.ok).toBe(true);
    expect(refreshCalls).toBe(0);
    expect(getCount).toBe(1);
  });

  test('hard-caps retry at 1: if the second GET also 404s, it surfaces', async () => {
    let refreshCalls = 0;
    let getCount = 0;
    const stubFetch: typeof globalThis.fetch = async () => {
      getCount += 1;
      return new Response(JSON.stringify({ error: { code: 'NotFound', message: 'still stale' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    };
    const http = new HttpClient({ baseUrl: 'http://stub', token: 'tok', fetch: stubFetch });
    const ctrl = new AbortController();
    await expect(
      http.getJsonWithRefresh(
        async () => '/v1/x',
        (raw) => raw,
        async () => {
          refreshCalls += 1;
        },
        ctrl.signal,
      ),
    ).rejects.toMatchObject({ code: EngineErrorCode.NotFound });
    expect(refreshCalls).toBe(1);
    expect(getCount).toBe(2);
  });
});

describe('CloudPageTextService — end-to-end transparent retry', () => {
  let fx: StubbedFixture;

  beforeEach(() => {
    fx = buildStub({
      docVersion: 1,
      pageContentVersion: 1,
      pageAnnotationVersion: 1,
      text: 'initial',
    });
  });

  test('first read with cold cache: fetches head + manifest + leaf', async () => {
    const doc = new CloudDocumentHandle(fx.http, DOC_ID);
    try {
      const page = doc.page(PAGE_OBJECT_NUMBER);
      const snap = await page.text.read();
      expect(snap.text).toBe('initial');
      expect(PageTextSnapshotSchema.safeParse(snap).success).toBe(true);
      const paths = fx.calls.map((c) => c.path);
      expect(paths).toEqual([
        `/v1/docs/${DOC_ID}/layers/${LAYER_NAME}/head`,
        `/v1/docs/${DOC_ID}/layers/${LAYER_NAME}/v1/manifest`,
        `/v1/docs/${DOC_ID}/layers/${LAYER_NAME}/pages/${PAGE_OBJECT_NUMBER}/v1/text`,
      ]);
    } finally {
      await doc.close();
    }
  });

  test('warm cache: second read on the same page skips head + manifest', async () => {
    const doc = new CloudDocumentHandle(fx.http, DOC_ID);
    try {
      const page = doc.page(PAGE_OBJECT_NUMBER);
      await page.text.read();
      const callsAfterFirst = fx.calls.length;
      await page.text.read();
      const newPaths = fx.calls.slice(callsAfterFirst).map((c) => c.path);
      expect(newPaths).toEqual([
        `/v1/docs/${DOC_ID}/layers/${LAYER_NAME}/pages/${PAGE_OBJECT_NUMBER}/v1/text`,
      ]);
    } finally {
      await doc.close();
    }
  });

  test('server flips manifest mid-flight: SDK transparently re-fetches and retries', async () => {
    const doc = new CloudDocumentHandle(fx.http, DOC_ID);
    try {
      const page = doc.page(PAGE_OBJECT_NUMBER);
      // Warm the cache so the SDK has docVersion=1 / pageContentVersion=1
      // squirrelled away.
      const first = await page.text.read();
      expect(first.text).toBe('initial');

      // Server bumps both versions, as a mutation would.
      fx.bump({ docVersion: 2, pageContentVersion: 2, text: 'after-mutation' });

      const callsBeforeRetry = fx.calls.length;
      const second = await page.text.read();
      expect(second.text).toBe('after-mutation');

      // The retry ladder must be exactly:
      //   [stale-leaf v1]   → 404
      //   [/head]           → 200 (docVersion=2)
      //   [/v2/manifest]    → 200 (pageContentVersion=2)
      //   [fresh-leaf v2]   → 200
      const retryPaths = fx.calls.slice(callsBeforeRetry).map((c) => c.path);
      expect(retryPaths).toEqual([
        `/v1/docs/${DOC_ID}/layers/${LAYER_NAME}/pages/${PAGE_OBJECT_NUMBER}/v1/text`,
        `/v1/docs/${DOC_ID}/layers/${LAYER_NAME}/head`,
        `/v1/docs/${DOC_ID}/layers/${LAYER_NAME}/v2/manifest`,
        `/v1/docs/${DOC_ID}/layers/${LAYER_NAME}/pages/${PAGE_OBJECT_NUMBER}/v2/text`,
      ]);

      // Cache is now warm with v2; a third read uses the new version
      // and goes straight to the leaf URL — no second refresh.
      const callsBeforeThird = fx.calls.length;
      const third = await page.text.read();
      expect(third.text).toBe('after-mutation');
      const thirdPaths = fx.calls.slice(callsBeforeThird).map((c) => c.path);
      expect(thirdPaths).toEqual([
        `/v1/docs/${DOC_ID}/layers/${LAYER_NAME}/pages/${PAGE_OBJECT_NUMBER}/v2/text`,
      ]);
    } finally {
      await doc.close();
    }
  });

  test('annotation list uses the same layer refresh-on-404 ladder', async () => {
    const doc = new CloudDocumentHandle(fx.http, DOC_ID);
    try {
      const page = doc.page(PAGE_OBJECT_NUMBER);
      const first = await page.annotations.list();
      expect(first.annotations).toEqual([]);
      expect(AnnotationListPageSnapshotSchema.safeParse(first).success).toBe(true);

      fx.bump({ docVersion: 2, pageAnnotationVersion: 2 });

      const callsBeforeRetry = fx.calls.length;
      const second = await page.annotations.list();
      expect(second.annotations).toEqual([]);

      const retryPaths = fx.calls.slice(callsBeforeRetry).map((c) => c.path);
      expect(retryPaths).toEqual([
        `/v1/docs/${DOC_ID}/layers/${LAYER_NAME}/pages/${PAGE_OBJECT_NUMBER}/v1/annotations`,
        `/v1/docs/${DOC_ID}/layers/${LAYER_NAME}/head`,
        `/v1/docs/${DOC_ID}/layers/${LAYER_NAME}/v2/manifest`,
        `/v1/docs/${DOC_ID}/layers/${LAYER_NAME}/pages/${PAGE_OBJECT_NUMBER}/v2/annotations`,
      ]);
    } finally {
      await doc.close();
    }
  });

  test('two concurrent first-reads share a single head+manifest round-trip (singleflight)', async () => {
    const doc = new CloudDocumentHandle(fx.http, DOC_ID);
    try {
      const page = doc.page(PAGE_OBJECT_NUMBER);
      const [a, b] = await Promise.all([page.text.read(), page.text.read()]);
      expect(a.text).toBe('initial');
      expect(b.text).toBe('initial');
      const headCount = fx.calls.filter((c) => c.path.endsWith('/head')).length;
      const manifestCount = fx.calls.filter((c) => c.path.endsWith('/manifest')).length;
      // Phase 4 contract: cold-cache fetches are singleflighted, so
      // even two parallel page reads trigger exactly one /head + one
      // /manifest. Without the inflight dedupe, this would be 2/2.
      expect(headCount).toBe(1);
      expect(manifestCount).toBe(1);
    } finally {
      await doc.close();
    }
  });

  test('read on a non-existent page surfaces NotFound without spuriously refreshing', async () => {
    const doc = new CloudDocumentHandle(fx.http, DOC_ID);
    try {
      const ghost = doc.page(999_999);
      let caught: unknown;
      try {
        await ghost.text.read();
      } catch (err) {
        caught = err;
      }
      expect(EngineError.is(caught, EngineErrorCode.NotFound)).toBe(true);
      const headCalls = fx.calls.filter((c) => c.path.endsWith('/head')).length;
      const manifestCalls = fx.calls.filter((c) => c.path.endsWith('/manifest')).length;
      // The SDK fetches the manifest once to resolve the page; the
      // "page not in manifest" branch throws locally and does NOT
      // trigger the 404→refresh ladder (no leaf call, no refresh).
      expect(headCalls).toBe(1);
      expect(manifestCalls).toBe(1);
      const leafCalls = fx.calls.filter((c) => c.path.includes('/text')).length;
      expect(leafCalls).toBe(0);
    } finally {
      await doc.close();
    }
  });
});

describe('CloudEngine schema parity — DocumentHeadSchema / DocumentManifestSchema', () => {
  // Pure shape parity test; ensures the schemas the cloud SDK depends on
  // accept the exact payloads the stub fixture produces. If a Zod shape
  // drifts (e.g. someone adds a required field on the server) this test
  // catches it before the cloud SDK silently regresses.
  test('schemas accept the stub fixture payloads', () => {
    const head = DocumentHeadSchema.safeParse({
      id: DOC_ID,
      baseSha: 'sha',
      pageCount: 1,
      storageSizeBytes: 1,
      docVersion: 1,
      state: 'ready',
    });
    expect(head.success).toBe(true);

    const manifest = DocumentManifestSchema.safeParse({
      docVersion: 1,
      baseSha: 'sha',
      pages: [
        {
          pageObjectNumber: 5,
          pageIndex: 0,
          revision: { docSessionId: 's', pageObjectNumber: 5, generation: 0 },
          weakAnnotationState: { kind: 'known', hasAnyWeakAnnotations: false },
          hasAnyWeakAnnotations: false,
          contentVersion: 1,
          annotationVersion: 1,
          hasWeakAnnotations: false,
        },
      ],
    });
    expect(manifest.success).toBe(true);
  });
});

void createCloudEngine;
