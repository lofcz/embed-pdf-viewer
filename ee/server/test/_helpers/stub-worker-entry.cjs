/**
 * Minimal stub worker for tests of WorkerThreadPool routing.
 *
 * The pool dispatches WorkerRequests of various kinds; this stub
 * implements only the surface that routing tests touch:
 *
 *   - `open.fatMem` / `open.layer*` -> echoes back a small open ack
 *   - `close` -> echoes back a small close ack
 *   - `shutdown` -> exits after acking
 *
 * Everything else gets a generic "not-implemented" reject so that
 * routing tests fail loudly instead of silently passing on stale
 * fixtures.
 */
const { parentPort } = require('node:worker_threads');
const { readFileSync } = require('node:fs');

// Per-open page count, derived from the byte payload's first byte
// so DocumentService tests can vary it. The stub records every open
// in a per-process Map and serves `pages.list` from it.
const openDocs = new Map();

function openSecurity() {
  return {
    encryptionState: 'none',
    encryptionRequiresPassword: false,
    securityHandlerRevision: null,
    pdfPermissionsBits: 0xffffffff,
    pdfPermissionsAllAllowed: true,
    pdfOpenedAs: 'none',
    securityProbedAt: Date.now(),
  };
}

function passwordSecurity(msg) {
  if (msg.password === 'owner') {
    return {
      encryptionState: 'encrypted',
      encryptionRequiresPassword: false,
      securityHandlerRevision: 6,
      pdfPermissionsBits: 0xfffffffc,
      pdfPermissionsAllAllowed: true,
      pdfOpenedAs: 'owner',
      securityProbedAt: Date.now(),
    };
  }
  return {
    encryptionState: 'encrypted',
    encryptionRequiresPassword: false,
    securityHandlerRevision: 6,
    pdfPermissionsBits: 0xfffff0c0,
    pdfPermissionsAllAllowed: false,
    pdfOpenedAs: 'user',
    securityProbedAt: Date.now(),
  };
}

function sessionKey(msg) {
  return msg.layerName ? `${msg.docId}::layer:${msg.layerName}` : msg.docId;
}

function layerMeta(msg) {
  const kind = msg.layer?.kind ?? 'fresh';
  if (kind === 'artifact' || kind === 'raw-delta') {
    const view = msg.layer.bytes ? new Uint8Array(msg.layer.bytes) : new Uint8Array(0);
    return { layerKind: kind, layerByte0: view.byteLength > 0 ? view[0] : null };
  }
  if (kind === 'artifact-file') {
    const bytes = msg.layer.path ? readFileSync(msg.layer.path) : Buffer.alloc(0);
    return { layerKind: 'artifact', layerByte0: bytes.byteLength > 0 ? bytes[0] : null };
  }
  return { layerKind: 'fresh', layerByte0: null };
}

function pageState(pon, generation = 0, hasWeak = false) {
  return {
    pageObjectNumber: pon,
    revision: { docSessionId: 'stub-session', pageObjectNumber: pon, generation },
    weakAnnotationState: { kind: 'known', hasAnyWeakAnnotations: hasWeak },
  };
}

// Pure geometry for one page. Mirrors `PageLayout`: durable PON, display
// `index`, and a letter-sized media/crop box. No annotation liveness here —
// that rides on annotation reads, not the geometry list.
function pageLayout(pon, index, rotation = 0) {
  const box = [0, 0, 612, 792];
  return {
    index,
    pageObjectNumber: pon,
    label: null,
    width: 612,
    height: 792,
    rotation,
    userUnit: 1,
    boxes: { media: box, crop: box },
  };
}

// Build a `PageListSnapshot` ({ pageCount, pages: PageLayout[] }) from the
// session's current page order (falling back to 1..pageCount) and the
// per-page rotations set by pages.rotate.
function layoutSnapshot(meta) {
  const order = meta.pageOrder ?? Array.from({ length: meta.pageCount }, (_, i) => i + 1);
  return {
    pageCount: order.length,
    pages: order.map((pon, index) => pageLayout(pon, index, meta.pageRotations?.[pon] ?? 0)),
  };
}

function annotation(pon, index = 0) {
  const annotObjectNumber = 10_000 + pon + index;
  return {
    subtype: 'unsupported',
    ref: { kind: 'objectNumber', pageObjectNumber: pon, annotObjectNumber },
    pageObjectNumber: pon,
    index,
    identityQuality: 'durable',
    nm: `stub-${pon}-${index}`,
    flags: {
      invisible: false,
      hidden: false,
      print: true,
      noZoom: false,
      noRotate: false,
      noView: false,
      readOnly: false,
      locked: false,
      toggleNoView: false,
      lockedContents: false,
    },
    rect: { left: 0, top: 0, right: 10, bottom: 10 },
    contents: null,
    author: null,
    created: null,
    modified: null,
    rawSubtypeCode: 0,
    rawSubtypeName: null,
  };
}

function mutationMeta(pon, generation, hasWeak = false) {
  const ann = annotation(pon);
  const state = pageState(pon, generation, hasWeak);
  return {
    affectedPages: [state],
    cacheDelta: null,
    changed: [{ kind: 'objectNumber', value: ann.ref.annotObjectNumber }],
    weakRefsInvalidated: false,
    shouldRefetch: null,
  };
}

function layerArtifact(msg, meta) {
  if (!msg.layerName) return undefined;
  const state = meta?.affectedPages?.[0];
  const pon = state?.pageObjectNumber ?? 0;
  const generation = state?.revision?.generation ?? 0;
  const view = new Uint8Array([
    0x4c,
    pon & 0xff,
    generation & 0xff,
    Date.now() & 0xff,
  ]);
  return { bytes: view.buffer, size: view.byteLength };
}

function resolveMutation(msg, payload) {
  parentPort.postMessage(
    {
      kind: 'resolve',
      jobId: msg.jobId,
      result: payload,
    },
    payload.artifact ? [payload.artifact.bytes] : [],
  );
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
        result: { tag: 'open', docId: msg.docId, security: openSecurity() },
      });
      return;
    }
    case 'open.layerMemBase': {
      // Layer sessions are addressed by docId + layerName. The first
      // byte of the base payload still encodes page count for tests.
      const view = msg.baseBytes ? new Uint8Array(msg.baseBytes) : new Uint8Array(0);
      const pageCount = view.byteLength > 0 ? view[0] : 0;
      openDocs.set(sessionKey(msg), { pageCount, ...layerMeta(msg) });
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: { tag: 'open', docId: msg.docId, security: openSecurity() },
      });
      return;
    }
    case 'open.layerFileBase': {
      // Server doc routes pass a materialised file path so native
      // PDFium can range-read the base. The stub reads only to recover
      // the test page-count byte.
      const bytes = msg.basePath ? readFileSync(msg.basePath) : Buffer.alloc(0);
      const pageCount = bytes.byteLength > 0 ? bytes[0] : 0;
      openDocs.set(sessionKey(msg), { pageCount, ...layerMeta(msg) });
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: { tag: 'open', docId: msg.docId, security: openSecurity() },
      });
      return;
    }
    case 'document.checkPasswordPermissions': {
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: {
          tag: 'document.checkPasswordPermissions',
          security: passwordSecurity(msg),
        },
      });
      return;
    }
    case 'document.probeSecurityFile': {
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: {
          tag: 'document.probeSecurityFile',
          security: {
            encryptionState: 'none',
            encryptionRequiresPassword: false,
            securityHandlerRevision: null,
            pdfPermissionsBits: 0xffffffff,
            pdfPermissionsAllAllowed: true,
            pdfOpenedAs: 'none',
            securityProbedAt: Date.now(),
          },
        },
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
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: {
          tag: 'pages.list',
          snapshot: layoutSnapshot(meta),
        },
      });
      return;
    }
    case 'annotations.listRawAll': {
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
          pageState: {
            pageObjectNumber: i + 1,
            revision: { docSessionId: 'stub-session', pageObjectNumber: i + 1, generation: 0 },
            weakAnnotationState: { kind: 'known', hasAnyWeakAnnotations: false },
          },
          annotations: [],
        });
      }
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: {
          tag: 'annotations.listRawAll',
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
      const layerSuffix =
        meta.layerKind && meta.layerKind !== 'fresh'
          ? ` ${meta.layerKind}:${meta.layerByte0 ?? 'empty'}`
          : '';
      const text = `stub text for ${msg.docId} page ${pon}${layerSuffix}`;
      parentPort.postMessage({
        kind: 'resolve',
        jobId: msg.jobId,
        result: {
          tag: 'pages.text',
          // No pageState: content reads carry geometry/text only; liveness
          // (revision/weak state) rides on annotation reads + the manifest.
          snapshot: {
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
              revision: { docSessionId: 'stub-session', pageObjectNumber: pon, generation: 0 },
              weakAnnotationState: { kind: 'known', hasAnyWeakAnnotations: false },
            },
            annotations: [],
          },
        },
      });
      return;
    }
    case 'annotations.create': {
      const pon = msg.pageObjectNumber;
      const ann = annotation(pon);
      const meta = mutationMeta(pon, 0, false);
      resolveMutation(msg, {
        tag: 'annotations.create',
        result: { created: ann, meta },
        artifact: layerArtifact(msg, meta),
      });
      return;
    }
    case 'annotations.update': {
      const pon = msg.ref.pageObjectNumber;
      const ann = annotation(pon, msg.ref.kind === 'index' ? msg.ref.index : 0);
      const meta = mutationMeta(pon, 0, false);
      resolveMutation(msg, {
        tag: 'annotations.update',
        result: { updated: ann, meta },
        artifact: layerArtifact(msg, meta),
      });
      return;
    }
    case 'annotations.delete': {
      const pon = msg.ref.pageObjectNumber;
      const meta = mutationMeta(pon, 1, false);
      resolveMutation(msg, {
        tag: 'annotations.delete',
        result: { deleted: { kind: 'objectNumber', value: 10_000 + pon }, meta },
        artifact: layerArtifact(msg, meta),
      });
      return;
    }
    case 'annotations.move': {
      const pon = msg.pageObjectNumber;
      const meta = mutationMeta(pon, 1, false);
      resolveMutation(msg, {
        tag: 'annotations.move',
        result: { moved: msg.refs.map((_, i) => annotation(pon, msg.toIndex + i)), meta },
        artifact: layerArtifact(msg, meta),
      });
      return;
    }
    case 'pages.move': {
      const meta = openDocs.get(sessionKey(msg));
      if (!meta) {
        parentPort.postMessage({
          kind: 'reject',
          jobId: msg.jobId,
          error: { name: 'EngineError', message: `not open: ${msg.docId}`, code: 'DocNotOpen' },
        });
        return;
      }
      const current = meta.pageOrder ?? Array.from({ length: meta.pageCount }, (_, i) => i + 1);
      const moving = new Set(msg.pageObjectNumbers);
      const remaining = current.filter((pon) => !moving.has(pon));
      const next = [
        ...remaining.slice(0, msg.destIndex),
        ...msg.pageObjectNumbers,
        ...remaining.slice(msg.destIndex),
      ];
      meta.pageOrder = next;
      // A move returns geometry, not liveness: the new layout + null cache
      // (the server fills in the real coherence pins on commit).
      const result = {
        layout: layoutSnapshot(meta),
        cache: null,
      };
      resolveMutation(msg, {
        tag: 'pages.move',
        result,
        artifact: layerArtifact(msg),
      });
      return;
    }
    case 'pages.rotate': {
      const meta = openDocs.get(sessionKey(msg));
      if (!meta) {
        parentPort.postMessage({
          kind: 'reject',
          jobId: msg.jobId,
          error: { name: 'EngineError', message: `not open: ${msg.docId}`, code: 'DocNotOpen' },
        });
        return;
      }
      // Rotation is presentation metadata: same pages, same order, new
      // per-page rotation values (the real mutator's exact contract).
      meta.pageRotations = meta.pageRotations ?? {};
      for (const pon of msg.pageObjectNumbers) {
        meta.pageRotations[pon] = msg.rotation;
      }
      resolveMutation(msg, {
        tag: 'pages.rotate',
        result: { layout: layoutSnapshot(meta), cache: null },
        artifact: layerArtifact(msg),
      });
      return;
    }
    case 'pages.delete': {
      const meta = openDocs.get(sessionKey(msg));
      if (!meta) {
        parentPort.postMessage({
          kind: 'reject',
          jobId: msg.jobId,
          error: { name: 'EngineError', message: `not open: ${msg.docId}`, code: 'DocNotOpen' },
        });
        return;
      }
      const current = meta.pageOrder ?? Array.from({ length: meta.pageCount }, (_, i) => i + 1);
      if (msg.pageObjectNumbers.length >= current.length) {
        // Mirrors PagesMutator: a document must keep at least one page.
        parentPort.postMessage({
          kind: 'reject',
          jobId: msg.jobId,
          error: {
            name: 'EngineError',
            message: 'pages.delete would remove every page',
            code: 'InvalidArg',
          },
        });
        return;
      }
      const deleting = new Set(msg.pageObjectNumbers);
      meta.pageOrder = current.filter((pon) => !deleting.has(pon));
      resolveMutation(msg, {
        tag: 'pages.delete',
        result: { layout: layoutSnapshot(meta), cache: null },
        artifact: layerArtifact(msg),
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
