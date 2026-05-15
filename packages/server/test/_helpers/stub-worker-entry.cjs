/**
 * Minimal stub worker for tests of WorkerThreadPool routing.
 *
 * The pool dispatches WorkerRequests of various kinds; this stub
 * implements only the surface that routing tests touch:
 *
 *   - `open.fatMem` -> echoes back a small open ack
 *   - `close` -> echoes back a small close ack
 *   - `shutdown` -> exits after acking
 *
 * Everything else gets a generic "not-implemented" reject so that
 * routing tests fail loudly instead of silently passing on stale
 * fixtures.
 */
const { parentPort } = require('node:worker_threads');

// Per-open page count, derived from the byte payload's first byte
// so DocumentService tests can vary it. The stub records every open
// in a per-process Map and serves `pages.list` from it.
const openDocs = new Map();

function sessionKey(msg) {
  return msg.layerName ? `${msg.docId}::layer:${msg.layerName}` : msg.docId;
}

parentPort.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.kind) {
    case 'open.fatMem': {
      // First byte of the payload encodes the page count for tests.
      // Real workers ignore the bytes' meaning here; this is a stub
      // convenience.
      const view = msg.bytes ? new Uint8Array(msg.bytes) : new Uint8Array(0);
      const pageCount = view.byteLength > 0 ? view[0] : 0;
      openDocs.set(sessionKey(msg), { pageCount });
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: { tag: 'open', docId: msg.docId },
      });
      return;
    }
    case 'open.layerMemBase': {
      // Layer sessions are addressed by docId + layerName. The first
      // byte of the base payload still encodes page count for tests.
      const view = msg.baseBytes ? new Uint8Array(msg.baseBytes) : new Uint8Array(0);
      const pageCount = view.byteLength > 0 ? view[0] : 0;
      openDocs.set(sessionKey(msg), { pageCount });
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: { tag: 'open', docId: msg.docId },
      });
      return;
    }
    case 'pages.list': {
      const meta = openDocs.get(sessionKey(msg));
      if (!meta) {
        parentPort.postMessage({
          kind: 'reject',
          jobId: msg.jobId,
          error: { name: 'EngineError', message: `not open: ${msg.docId}`, code: 'DocNotOpen' },
        });
        return;
      }
      const pages = [];
      for (let i = 0; i < meta.pageCount; i++) {
        pages.push({
          pageObjectNumber: i + 1,
          pageIndex: i,
          revision: { docSessionId: 'stub-session', pageObjectNumber: i + 1, generation: 0 },
          hasAnyWeakAnnotations: false,
        });
      }
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: {
          tag: 'pages.list',
          snapshot: { pages },
        },
      });
      return;
    }
    case 'pages.text': {
      const meta = openDocs.get(sessionKey(msg));
      if (!meta) {
        parentPort.postMessage({
          kind: 'reject',
          jobId: msg.jobId,
          error: { name: 'EngineError', message: `not open: ${msg.docId}`, code: 'DocNotOpen' },
        });
        return;
      }
      const pon = msg.pageObjectNumber;
      if (pon < 1 || pon > meta.pageCount) {
        parentPort.postMessage({
          kind: 'reject',
          jobId: msg.jobId,
          error: {
            name: 'EngineError',
            message: `no page with object number ${pon}`,
            code: 'NotFound',
          },
        });
        return;
      }
      const text = `stub text for ${msg.docId} page ${pon}`;
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: {
          tag: 'pages.text',
          snapshot: {
            pageState: {
              pageObjectNumber: pon,
              pageIndex: pon - 1,
              revision: { docSessionId: 'stub-session', pageObjectNumber: pon, generation: 0 },
              hasAnyWeakAnnotations: false,
            },
            text,
            charCount: text.length,
          },
        },
      });
      return;
    }
    case 'annotations.listFullPage': {
      const meta = openDocs.get(sessionKey(msg));
      if (!meta) {
        parentPort.postMessage({
          kind: 'reject',
          jobId: msg.jobId,
          error: { name: 'EngineError', message: `not open: ${msg.docId}`, code: 'DocNotOpen' },
        });
        return;
      }
      const pon = msg.pageObjectNumber;
      if (pon < 1 || pon > meta.pageCount) {
        parentPort.postMessage({
          kind: 'reject',
          jobId: msg.jobId,
          error: {
            name: 'EngineError',
            message: `no page with object number ${pon}`,
            code: 'NotFound',
          },
        });
        return;
      }
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: {
          tag: 'annotations.listFullPage',
          snapshot: {
            pageState: {
              pageObjectNumber: pon,
              pageIndex: pon - 1,
              revision: { docSessionId: 'stub-session', pageObjectNumber: pon, generation: 0 },
              hasAnyWeakAnnotations: false,
            },
            annotations: [],
          },
        },
      });
      return;
    }
    case 'close':
      for (const key of Array.from(openDocs.keys())) {
        if (key === msg.docId || key.startsWith(`${msg.docId}::layer:`)) {
          openDocs.delete(key);
        }
      }
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: { tag: 'close', docId: msg.docId },
      });
      return;
    case 'abort':
      // Pool sends this to interrupt an in-flight job; we have no
      // long-running jobs in this stub, so we ignore it.
      return;
    case 'shutdown':
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: { tag: 'shutdown' },
      });
      setTimeout(() => process.exit(0), 5);
      return;
    default:
      parentPort.postMessage({
        kind: 'reject',
        jobId: msg.jobId,
        error: {
          name: 'EngineError',
          message: `stub worker: kind '${msg.kind}' not implemented`,
          code: 'Unknown',
        },
      });
  }
});

parentPort.postMessage({ kind: 'ready' });
