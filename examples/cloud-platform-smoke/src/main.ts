import { createCloudEngine } from '@embedpdf/engine-cloud';
import type {
  AnnotationDraft,
  AnnotationListPageSnapshot,
  AnnotationRef,
  DocumentHandle,
  PageListSnapshot,
  PageObjectNumber,
  WeakAnnotationEditSession,
} from '@embedpdf/engine-core/runtime';
import './styles.css';

interface AppConfig {
  tenantId: string;
  engineBaseUrl: string;
  originBaseUrl: string;
  dataRoot: string;
}

interface UploadResponse {
  tag: 'created' | 'deduped';
  document: {
    id: string;
    tenantId: string;
    state: string;
    pageCount: number | null;
    metadata: Record<string, unknown> | null;
  };
  token: string;
  tenantId: string;
  layerName: string;
  sub: string;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app missing');

app.innerHTML = `
  <section class="shell">
    <header class="topbar">
      <div>
        <h1>EmbedPDF Cloud Smoke</h1>
        <p id="status">Connecting...</p>
      </div>
      <button id="refreshDocs" type="button">Refresh Docs</button>
    </header>

    <section class="grid">
      <section class="panel">
        <h2>Admin</h2>
        <label>Tenant <input id="tenantId" autocomplete="off" /></label>
        <label>Layer <input id="layerName" autocomplete="off" value="default" /></label>
        <label>User <input id="subject" autocomplete="off" value="demo-user" /></label>
        <label>PDF <input id="pdfFile" type="file" accept="application/pdf" /></label>
        <button id="uploadPdf" type="button">Upload PDF + Mint Token</button>

        <div class="split">
          <label>Existing Doc ID <input id="mintDocId" autocomplete="off" /></label>
          <button id="mintToken" type="button">Mint Token For Layer</button>
        </div>

        <div class="split">
          <label>Audit Day <input id="auditDay" autocomplete="off" /></label>
          <button id="exportAudit" type="button">Export Audit JSONL</button>
        </div>
        <label class="check">
          <input id="allowOpenDay" type="checkbox" checked />
          <span>Allow open day export</span>
        </label>

        <label>Document Token <textarea id="tokenBox" spellcheck="false"></textarea></label>
        <div id="docs" class="list"></div>
      </section>

      <section class="panel">
        <h2>Cloud Engine</h2>
        <button id="openToken" type="button">Open Token</button>
        <div id="claims" class="kv"></div>

        <div class="split">
          <label>Page Object Number <input id="pageObjectNumber" inputmode="numeric" /></label>
          <button id="listPages" type="button">List Pages</button>
        </div>

        <div class="actions">
          <button id="readText" type="button">Read Text</button>
          <button id="listAnnots" type="button">List Annotations</button>
          <button id="createHighlight" type="button">Create Highlight</button>
          <button id="beginWeakEdit" type="button">Begin Weak Edit</button>
          <button id="heartbeatWeakEdit" type="button">Heartbeat</button>
          <button id="releaseWeakEdit" type="button">Release</button>
          <button id="deleteFirst" type="button">Delete First</button>
          <button id="moveFirst" type="button">Move First To End</button>
        </div>

        <pre id="output"></pre>
      </section>
    </section>
  </section>
`;

const els = {
  status: must<HTMLParagraphElement>('status'),
  tenantId: must<HTMLInputElement>('tenantId'),
  layerName: must<HTMLInputElement>('layerName'),
  subject: must<HTMLInputElement>('subject'),
  pdfFile: must<HTMLInputElement>('pdfFile'),
  uploadPdf: must<HTMLButtonElement>('uploadPdf'),
  mintDocId: must<HTMLInputElement>('mintDocId'),
  mintToken: must<HTMLButtonElement>('mintToken'),
  auditDay: must<HTMLInputElement>('auditDay'),
  exportAudit: must<HTMLButtonElement>('exportAudit'),
  allowOpenDay: must<HTMLInputElement>('allowOpenDay'),
  tokenBox: must<HTMLTextAreaElement>('tokenBox'),
  docs: must<HTMLDivElement>('docs'),
  openToken: must<HTMLButtonElement>('openToken'),
  claims: must<HTMLDivElement>('claims'),
  pageObjectNumber: must<HTMLInputElement>('pageObjectNumber'),
  listPages: must<HTMLButtonElement>('listPages'),
  readText: must<HTMLButtonElement>('readText'),
  listAnnots: must<HTMLButtonElement>('listAnnots'),
  createHighlight: must<HTMLButtonElement>('createHighlight'),
  beginWeakEdit: must<HTMLButtonElement>('beginWeakEdit'),
  heartbeatWeakEdit: must<HTMLButtonElement>('heartbeatWeakEdit'),
  releaseWeakEdit: must<HTMLButtonElement>('releaseWeakEdit'),
  deleteFirst: must<HTMLButtonElement>('deleteFirst'),
  moveFirst: must<HTMLButtonElement>('moveFirst'),
  refreshDocs: must<HTMLButtonElement>('refreshDocs'),
  output: must<HTMLPreElement>('output'),
};

let config: AppConfig;
let doc: DocumentHandle | null = null;
let pages: PageListSnapshot | null = null;
let annotations: AnnotationListPageSnapshot | null = null;
let weakSession: WeakAnnotationEditSession | null = null;

void boot();

async function boot(): Promise<void> {
  config = await getJson<AppConfig>('/api/config');
  els.tenantId.value = config.tenantId;
  els.auditDay.value = new Date().toISOString().slice(0, 10);
  els.status.textContent = `Origin ${config.originBaseUrl}`;
  await refreshDocs();
}

els.refreshDocs.addEventListener('click', () => void run(refreshDocs));
els.uploadPdf.addEventListener('click', () => void run(uploadPdf));
els.mintToken.addEventListener('click', () => void run(mintToken));
els.exportAudit.addEventListener('click', () => void run(exportAudit));
els.openToken.addEventListener('click', () => void run(openToken));
els.listPages.addEventListener('click', () => void run(listPages));
els.readText.addEventListener('click', () => void run(readText));
els.listAnnots.addEventListener('click', () => void run(listAnnotations));
els.createHighlight.addEventListener('click', () => void run(createHighlight));
els.beginWeakEdit.addEventListener('click', () => void run(beginWeakEdit));
els.heartbeatWeakEdit.addEventListener('click', () => void run(heartbeatWeakEdit));
els.releaseWeakEdit.addEventListener('click', () => void run(releaseWeakEdit));
els.deleteFirst.addEventListener('click', () => void run(deleteFirstAnnotation));
els.moveFirst.addEventListener('click', () => void run(moveFirstAnnotation));

async function uploadPdf(): Promise<void> {
  const file = els.pdfFile.files?.[0];
  if (!file) throw new Error('Choose a PDF first.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const params = new URLSearchParams({
    tenantId: tenantId(),
    layerName: layerName(),
    sub: subject(),
  });
  const response = await fetch(`/api/admin/upload?${params}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-File-Name': file.name,
    },
    body: bytes,
  });
  const result = await parseResponse<UploadResponse>(response);
  els.tokenBox.value = result.token;
  els.mintDocId.value = result.document.id;
  setOutput(result);
  await refreshDocs();
}

async function mintToken(): Promise<void> {
  const docId = els.mintDocId.value.trim();
  if (!docId) throw new Error('Choose or enter a doc id.');
  const result = await postJson<{ token: string; layerName: string; docId: string }>(
    '/api/admin/mint-token',
    {
      tenantId: tenantId(),
      docId,
      layerName: layerName(),
      sub: subject(),
      ttlSeconds: 3600,
    },
  );
  els.tokenBox.value = result.token;
  setOutput(result);
}

async function exportAudit(): Promise<void> {
  const docId = els.mintDocId.value.trim();
  if (!docId) throw new Error('Choose or enter a doc id.');
  const result = await postJson('/api/admin/audit-export', {
    tenantId: tenantId(),
    docId,
    day: els.auditDay.value.trim(),
    allowOpenDay: els.allowOpenDay.checked,
    force: true,
  });
  setOutput(result);
}

async function openToken(): Promise<void> {
  const token = els.tokenBox.value.trim();
  if (!token) throw new Error('Paste or mint a document token.');
  await doc?.close();
  weakSession = null;
  pages = null;
  annotations = null;
  const engine = createCloudEngine({ baseUrl: config.engineBaseUrl });
  doc = await engine.open({ kind: 'token', token });
  renderClaims(token);
  await listPages();
}

async function listPages(): Promise<void> {
  const opened = requireDoc();
  pages = await opened.pages.list();
  const first = pages.pages[0];
  if (first && !els.pageObjectNumber.value) {
    els.pageObjectNumber.value = String(first.pageObjectNumber);
  }
  setOutput(pages);
}

async function readText(): Promise<void> {
  const page = requireDoc().page(selectedPage());
  setOutput(await page.text.read());
}

async function listAnnotations(): Promise<void> {
  annotations = await requireDoc().page(selectedPage()).annotations.list();
  setOutput(annotations);
}

async function createHighlight(): Promise<void> {
  const draft: AnnotationDraft = {
    subtype: 'highlight',
    contents: `cloud smoke ${new Date().toISOString()}`,
    author: subject(),
    color: { r: 255, g: 214, b: 102 },
    opacity: 0.6,
    quadPoints: [
      {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 40, y: 0 },
        bottomLeft: { x: 0, y: 16 },
        bottomRight: { x: 40, y: 16 },
      },
    ],
  };
  const result = await requireDoc().page(selectedPage()).annotations.create(draft);
  setOutput(result);
  await listAnnotations();
}

async function beginWeakEdit(): Promise<void> {
  weakSession = await requireDoc().annotations.beginWeakEdit([selectedPage()]);
  setOutput({
    sessionId: weakSession.id,
    expiresAt: weakSession.expiresAt,
    heartbeatIntervalMs: weakSession.heartbeatIntervalMs,
    pageObjectNumbers: weakSession.pageObjectNumbers,
  });
}

async function heartbeatWeakEdit(): Promise<void> {
  if (!weakSession) throw new Error('No weak edit session.');
  await weakSession.updatePages([selectedPage()]);
  await weakSession.heartbeat();
  setOutput({
    sessionId: weakSession.id,
    expiresAt: weakSession.expiresAt,
    pageObjectNumbers: weakSession.pageObjectNumbers,
  });
}

async function releaseWeakEdit(): Promise<void> {
  if (!weakSession) return;
  await weakSession.release();
  setOutput({ released: weakSession.id });
  weakSession = null;
}

async function deleteFirstAnnotation(): Promise<void> {
  const ref = firstAnnotationRef();
  const result = await requireDoc().page(ref.pageObjectNumber).annotations.delete(ref);
  setOutput(result);
  await listAnnotations();
}

async function moveFirstAnnotation(): Promise<void> {
  const ref = firstAnnotationRef();
  const count = annotations?.annotations.length ?? 1;
  const result = await requireDoc()
    .page(ref.pageObjectNumber)
    .annotations.move([ref], count - 1);
  setOutput(result);
  await listAnnotations();
}

async function refreshDocs(): Promise<void> {
  const params = new URLSearchParams({ tenantId: tenantId() || config?.tenantId || 'tenant-demo' });
  const result = await getJson<{ documents: UploadResponse['document'][] }>(
    `/api/admin/documents?${params}`,
  );
  els.docs.innerHTML = '';
  for (const item of result.documents) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'doc-row';
    button.textContent = `${item.id} (${item.state}, pages ${item.pageCount ?? '?'})`;
    button.addEventListener('click', () => {
      els.mintDocId.value = item.id;
      setOutput(item);
    });
    els.docs.append(button);
  }
}

function firstAnnotationRef(): AnnotationRef {
  const first = annotations?.annotations[0];
  if (!first) throw new Error('List annotations first; there is no first annotation yet.');
  return first.ref;
}

function selectedPage(): PageObjectNumber {
  const value = Number(els.pageObjectNumber.value);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Page object number must be a positive integer.');
  }
  return value as PageObjectNumber;
}

function requireDoc(): DocumentHandle {
  if (!doc) throw new Error('Open a document token first.');
  return doc;
}

function tenantId(): string {
  return els.tenantId.value.trim() || config?.tenantId || 'tenant-demo';
}

function layerName(): string {
  return els.layerName.value.trim() || 'default';
}

function subject(): string {
  return els.subject.value.trim() || 'demo-user';
}

function renderClaims(token: string): void {
  const claims = decodeJwtPayload(token);
  els.claims.innerHTML = '';
  for (const key of ['tenant_id', 'doc_id', 'layer_name', 'sub', 'scope', 'exp']) {
    const row = document.createElement('div');
    row.innerHTML = `<span>${key}</span><strong>${JSON.stringify(claims[key])}</strong>`;
    els.claims.append(row);
  }
}

function setOutput(value: unknown): void {
  els.output.textContent = JSON.stringify(value, null, 2);
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    els.status.textContent = 'Working...';
    await fn();
    els.status.textContent = `Ready`;
  } catch (err) {
    els.status.textContent = 'Error';
    setOutput({ error: err instanceof Error ? err.message : String(err) });
  }
}

async function getJson<T>(path: string): Promise<T> {
  return parseResponse<T>(await fetch(path));
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return parseResponse<T>(
    await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  const json = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json
        ? JSON.stringify((json as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return json as T;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  if (!payload) return {};
  const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
  return JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
}
