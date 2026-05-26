import { createCloudEngine } from '@embedpdf/engine-cloud';
import type {
  AnnotationDraft,
  AnnotationListPageSnapshot,
  AnnotationRef,
  DocumentHandle,
  PageGeometrySnapshot,
  PageImageHandle,
  PageListSnapshot,
  PageObjectNumber,
  PdfSaveMode,
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
          <button id="readGeometry" type="button">Read Geometry</button>
          <button id="listAnnots" type="button">List Annotations</button>
          <button id="createHighlight" type="button">Create Highlight</button>
          <button id="beginWeakEdit" type="button">Begin Weak Edit</button>
          <button id="heartbeatWeakEdit" type="button">Heartbeat</button>
          <button id="releaseWeakEdit" type="button">Release</button>
          <button id="deleteFirst" type="button">Delete First</button>
          <button id="moveFirst" type="button">Move First To End</button>
        </div>

        <div class="download-tools">
          <label>Save Mode
            <select id="downloadMode">
              <option value="incremental">Incremental</option>
              <option value="rewrite">Rewrite</option>
            </select>
          </label>
          <button id="downloadPdf" type="button">Download PDF</button>
        </div>

        <div class="render-tools">
          <label>Render Format
            <select id="renderFormat">
              <option value="webp">WebP</option>
              <option value="png">PNG</option>
            </select>
          </label>
          <label>Width <input id="renderWidth" inputmode="numeric" value="720" /></label>
          <label>Background
            <select id="renderBackground">
              <option value="white">White</option>
              <option value="transparent">Transparent</option>
            </select>
          </label>
          <label class="check">
            <input id="renderAnnotations" type="checkbox" checked />
            <span>Include annotations</span>
          </label>
          <button id="renderPage" type="button">Render Page</button>
        </div>

        <figure id="renderPreview" class="render-preview">
          <img id="renderImage" alt="Rendered page preview" />
          <figcaption id="renderMeta">No render yet.</figcaption>
        </figure>

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
  readGeometry: must<HTMLButtonElement>('readGeometry'),
  listAnnots: must<HTMLButtonElement>('listAnnots'),
  renderFormat: must<HTMLSelectElement>('renderFormat'),
  renderWidth: must<HTMLInputElement>('renderWidth'),
  renderBackground: must<HTMLSelectElement>('renderBackground'),
  renderAnnotations: must<HTMLInputElement>('renderAnnotations'),
  renderPage: must<HTMLButtonElement>('renderPage'),
  renderPreview: must<HTMLElement>('renderPreview'),
  renderImage: must<HTMLImageElement>('renderImage'),
  renderMeta: must<HTMLElement>('renderMeta'),
  createHighlight: must<HTMLButtonElement>('createHighlight'),
  beginWeakEdit: must<HTMLButtonElement>('beginWeakEdit'),
  heartbeatWeakEdit: must<HTMLButtonElement>('heartbeatWeakEdit'),
  releaseWeakEdit: must<HTMLButtonElement>('releaseWeakEdit'),
  deleteFirst: must<HTMLButtonElement>('deleteFirst'),
  moveFirst: must<HTMLButtonElement>('moveFirst'),
  downloadMode: must<HTMLSelectElement>('downloadMode'),
  downloadPdf: must<HTMLButtonElement>('downloadPdf'),
  refreshDocs: must<HTMLButtonElement>('refreshDocs'),
  output: must<HTMLPreElement>('output'),
};

let config: AppConfig;
let doc: DocumentHandle | null = null;
let pages: PageListSnapshot | null = null;
let annotations: AnnotationListPageSnapshot | null = null;
let weakSession: WeakAnnotationEditSession | null = null;
let renderObjectUrl: string | null = null;

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
els.readGeometry.addEventListener('click', () => void run(readGeometry));
els.listAnnots.addEventListener('click', () => void run(listAnnotations));
els.renderPage.addEventListener('click', () => void run(renderPage));
els.createHighlight.addEventListener('click', () => void run(createHighlight));
els.beginWeakEdit.addEventListener('click', () => void run(beginWeakEdit));
els.heartbeatWeakEdit.addEventListener('click', () => void run(heartbeatWeakEdit));
els.releaseWeakEdit.addEventListener('click', () => void run(releaseWeakEdit));
els.deleteFirst.addEventListener('click', () => void run(deleteFirstAnnotation));
els.moveFirst.addEventListener('click', () => void run(moveFirstAnnotation));
els.downloadPdf.addEventListener('click', () => void run(downloadPdf));

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
  clearRenderPreview();
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

async function readGeometry(): Promise<void> {
  const page = requireDoc().page(selectedPage());
  setOutput(summarizeGeometry(await page.geometry.read()));
}

async function renderPage(): Promise<void> {
  const opened = requireDoc();
  const page = opened.page(selectedPage());
  const width = readPositiveInteger(els.renderWidth.value, 'Render width');
  const image = await page.render.image({
    format: renderFormat(),
    viewport: { kind: 'width', width },
    background: renderBackground(),
    includeAnnotations: els.renderAnnotations.checked,
  });
  await showRenderedImage(image);
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

async function downloadPdf(): Promise<void> {
  const opened = requireDoc();
  const mode = downloadMode();
  const bytes = await opened.download({ mode });
  const tokenClaims = decodeJwtPayload(els.tokenBox.value.trim());
  const docId = typeof tokenClaims.doc_id === 'string' ? tokenClaims.doc_id : opened.id;
  const layer =
    typeof tokenClaims.layer_name === 'string' && tokenClaims.layer_name.length > 0
      ? tokenClaims.layer_name
      : layerName();
  saveBytesAsPdf(bytes, `${safeFilePart(docId)}-${safeFilePart(layer)}-${mode}.pdf`);
  setOutput({
    downloaded: true,
    mode,
    bytes: bytes.byteLength,
    fileName: `${safeFilePart(docId)}-${safeFilePart(layer)}-${mode}.pdf`,
  });
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
    button.textContent = `${item.id} (${item.state})`;
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
  return readPositiveInteger(els.pageObjectNumber.value, 'Page object number') as PageObjectNumber;
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

function renderFormat(): 'png' | 'webp' {
  if (els.renderFormat.value === 'png' || els.renderFormat.value === 'webp') {
    return els.renderFormat.value;
  }
  throw new Error('Render format must be PNG or WebP.');
}

function renderBackground(): 'white' | 'transparent' {
  if (els.renderBackground.value === 'white' || els.renderBackground.value === 'transparent') {
    return els.renderBackground.value;
  }
  throw new Error('Render background must be white or transparent.');
}

function downloadMode(): PdfSaveMode {
  if (els.downloadMode.value === 'incremental' || els.downloadMode.value === 'rewrite') {
    return els.downloadMode.value;
  }
  throw new Error('Download mode must be incremental or rewrite.');
}

function readPositiveInteger(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

async function showRenderedImage(image: PageImageHandle): Promise<void> {
  clearRenderPreview();
  const objectUrl = await image.objectUrl();
  renderObjectUrl = objectUrl.url;

  els.renderImage.src = renderObjectUrl;
  els.renderPreview.classList.add('has-image');
  els.renderMeta.textContent = [
    `${image.format.toUpperCase()} page ${image.pageState.pageObjectNumber}`,
    image.width && image.height
      ? `${image.width}x${image.height}`
      : `width ${els.renderWidth.value}`,
    els.renderAnnotations.checked ? 'annotations on' : 'annotations off',
  ].join(' | ');
  setOutput({
    pageState: image.pageState,
    format: image.format,
    contentType: image.contentType,
    source:
      image.source.kind === 'url' ? image.source.url : `${image.source.bytes.byteLength} bytes`,
  });
}

function clearRenderPreview(): void {
  if (renderObjectUrl) {
    URL.revokeObjectURL(renderObjectUrl);
    renderObjectUrl = null;
  }
  els.renderImage.removeAttribute('src');
  els.renderPreview.classList.remove('has-image');
  els.renderMeta.textContent = 'No render yet.';
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

function saveBytesAsPdf(bytes: Uint8Array, fileName: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilePart(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'document';
}

function summarizeGeometry(snapshot: PageGeometrySnapshot): unknown {
  return {
    pageState: snapshot.pageState,
    runCount: snapshot.runs.length,
    glyphCount: snapshot.runs.reduce((total, run) => total + run.glyphs.length, 0),
    sampleRuns: snapshot.runs.slice(0, 5),
  };
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
