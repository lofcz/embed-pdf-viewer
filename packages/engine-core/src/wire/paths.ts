/**
 * Single source of truth for cloud HTTP paths. Both engine-cloud and
 * @embedpdf/server import these so they cannot drift.
 */
import {
  encodeAnnotationToken,
  encodeContentToken,
  encodeDocToken,
  encodeDownloadToken,
  encodeRenderToken,
  type DownloadToken,
  type TokenInput,
} from './tokens';

export const DEFAULT_LAYER_NAME = 'default';

export const wirePaths = {
  /**
   * GET: open the document referenced by the doc-scoped JWT and
   * return its `DocumentHead`. The server materialises the base
   * PDF into its file cache and binds it to a worker the first
   * time this is hit.
   */
  docHead: (docId: string) => `/v1/docs/${encodeURIComponent(docId)}/head`,

  /**
   * GET: layer-scoped head. The cloud SDK always uses a layer namespace;
   * tokens without `layer_name` bind to `DEFAULT_LAYER_NAME`.
   */
  layerHead: (docId: string, layerName: string) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/head`,

  /**
   * GET: full document manifest at a specific `docVersion`. Content-
   * addressed: the URL bytes are immutable for the lifetime of the
   * version, so CDNs may cache `public, max-age=31536000, immutable`.
   * A request whose `docVersion` mismatches the current version
   * returns 404 — the SDK refetches `/head` to learn the new
   * version, then re-requests the manifest at the new URL.
   */
  docManifest: (docId: string, docVersion: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/manifest@${encodeDocToken(docVersion)}`,

  /**
   * GET: full layer manifest at a specific layer document version.
   * Never-mutated layers may fall through to the immutable base view;
   * once a layer row exists, `layers.doc_version` and `layer_pages`
   * drive the response.
   */
  layerManifest: (docId: string, layerName: string, docVersion: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/manifest@${encodeDocToken(docVersion)}`,

  layerMetadata: (docId: string, layerName: string, docVersion: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/metadata@${encodeDocToken(docVersion)}`,

  layerMetadataCurrent: (docId: string, layerName: string) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/metadata`,

  /**
   * GET: full plain-text extraction for a single page at a specific
   * `contentVersion`. Content-addressed; CDN may cache forever.
   * Stale-version requests return 404 and the SDK's transparent
   * retry walks `/head` → `/manifest@docVersion=N` to learn the new
   * `contentVersion`.
   */
  docPageText: (docId: string, pageObjectNumber: number, contentVersion: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/pages/${pageObjectNumber}/text@${encodeContentToken(contentVersion)}`,

  layerPageText: (
    docId: string,
    layerName: string,
    pageObjectNumber: number,
    contentVersion: number,
  ) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/pages/${pageObjectNumber}/text@${encodeContentToken(contentVersion)}`,

  layerPageTextCurrent: (docId: string, layerName: string, pageObjectNumber: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/pages/${pageObjectNumber}/text`,

  docPageGeometry: (docId: string, pageObjectNumber: number, contentVersion: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/pages/${pageObjectNumber}/geometry@${encodeContentToken(contentVersion)}`,

  docPageGeometryCurrent: (docId: string, pageObjectNumber: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/pages/${pageObjectNumber}/geometry`,

  docPageRender: (docId: string, pageObjectNumber: number, token: TokenInput) =>
    `/v1/docs/${encodeURIComponent(docId)}/pages/${pageObjectNumber}/render@${encodeRenderToken(token)}`,

  docPageRenderCurrent: (docId: string, pageObjectNumber: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/pages/${pageObjectNumber}/render`,

  layerPageGeometry: (
    docId: string,
    layerName: string,
    pageObjectNumber: number,
    contentVersion: number,
  ) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/pages/${pageObjectNumber}/geometry@${encodeContentToken(contentVersion)}`,

  layerPageGeometryCurrent: (docId: string, layerName: string, pageObjectNumber: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/pages/${pageObjectNumber}/geometry`,

  layerPageRender: (
    docId: string,
    layerName: string,
    pageObjectNumber: number,
    token: TokenInput,
  ) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/pages/${pageObjectNumber}/render@${encodeRenderToken(token)}`,

  layerPageRenderCurrent: (docId: string, layerName: string, pageObjectNumber: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/pages/${pageObjectNumber}/render`,

  /**
   * GET: full annotation list for a single page at a specific
   * `annotationVersion`. Same cache-control rules and 404-retry
   * semantics as `docPageText`.
   */
  docPageAnnotations: (docId: string, pageObjectNumber: number, annotationVersion: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/pages/${pageObjectNumber}/annotations@${encodeAnnotationToken(annotationVersion)}`,

  layerPageAnnotations: (
    docId: string,
    layerName: string,
    pageObjectNumber: number,
    annotationVersion: number,
  ) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/pages/${pageObjectNumber}/annotations@${encodeAnnotationToken(annotationVersion)}`,

  layerPageAnnotationsCurrent: (docId: string, layerName: string, pageObjectNumber: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/pages/${pageObjectNumber}/annotations`,

  layerPageAnnotationsCreate: (docId: string, layerName: string, pageObjectNumber: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/pages/${pageObjectNumber}/annotations`,

  layerAnnotationByKey: (docId: string, layerName: string, pageObjectNumber: number, key: string) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/pages/${pageObjectNumber}/annotations/${encodeURIComponent(key)}`,

  layerPageAnnotationsMove: (docId: string, layerName: string, pageObjectNumber: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/pages/${pageObjectNumber}/annotations/move`,

  layerPagesMove: (docId: string, layerName: string) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/pages/move`,

  layerDownload: (docId: string, layerName: string) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/download`,

  layerDownloadVersioned: (docId: string, layerName: string, token: DownloadToken) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/download@${encodeDownloadToken(token)}`,

  layerWeakAnnotationSession: (docId: string, layerName: string) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/weak-annotation-session`,

  layerWeakAnnotationSessionHeartbeat: (docId: string, layerName: string, sessionId: string) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/weak-annotation-session/${encodeURIComponent(sessionId)}/heartbeat`,

  layerWeakAnnotationSessionPages: (docId: string, layerName: string, sessionId: string) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/weak-annotation-session/${encodeURIComponent(sessionId)}/pages`,

  layerWeakAnnotationSessionRelease: (docId: string, layerName: string, sessionId: string) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/weak-annotation-session/${encodeURIComponent(sessionId)}`,

  /**
   * POST: pre-warm the doc cache + worker open before any user
   * request lands. Body is `{ docId }`. Doc-scoped token required.
   */
  docWarm: '/v1/warm',
} as const;
