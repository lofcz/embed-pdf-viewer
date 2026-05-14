/**
 * Minimal stub worker for tests of WorkerThreadPool routing.
 *
 * The pool dispatches WorkerRequests of various kinds; this stub
 * implements only the surface that routing tests touch:
 *
 *   - `open`  -> echoes back a small open ack
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

parentPort.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.kind) {
    case 'open': {
      // First byte of the payload encodes the page count for tests.
      // Real workers ignore the bytes' meaning here; this is a stub
      // convenience.
      const view = msg.bytes ? new Uint8Array(msg.bytes) : new Uint8Array(0);
      const pageCount = view.byteLength > 0 ? view[0] : 0;
      openDocs.set(msg.docId, { pageCount });
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: { tag: 'open', docId: msg.docId },
      });
      return;
    }
    case 'pages.list': {
      const meta = openDocs.get(msg.docId);
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
          index: i,
          pageObjectNumber: i + 1,
          widthPt: 612,
          heightPt: 792,
          rotation: 0,
        });
      }
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: {
          tag: 'pages.list',
          snapshot: { pages, revision: { token: 'stub' } },
        },
      });
      return;
    }
    case 'close':
      openDocs.delete(msg.docId);
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
