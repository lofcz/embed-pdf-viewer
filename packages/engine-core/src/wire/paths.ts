/**
 * Single source of truth for cloud HTTP paths. Both engine-cloud and
 * @embedpdf/server import these so they cannot drift.
 */
export const wirePaths = {
  documents: '/v1/documents',
  document: (docId: string) => `/v1/documents/${encodeURIComponent(docId)}`,
  metadata: (docId: string) => `/v1/documents/${encodeURIComponent(docId)}/metadata`,

  /**
   * Document-wide raw annotation read. Returns
   * `AnnotationListSnapshotAllPages`. Fast path: never acquires a pagePtr.
   */
  annotationsRawAll: (docId: string) => `/v1/documents/${encodeURIComponent(docId)}/annotations`,

  /**
   * Per-page raw annotation read. Page is addressed by PDF indirect
   * object number, never by index.
   */
  annotationsRawPage: (docId: string, pageObjectNumber: number) =>
    `/v1/documents/${encodeURIComponent(docId)}/pages/${pageObjectNumber}/annotations/raw`,

  /**
   * Per-page full annotation read. Slow path: acquires a pagePtr and
   * dispatches per-subtype readers.
   */
  annotationsFullPage: (docId: string, pageObjectNumber: number) =>
    `/v1/documents/${encodeURIComponent(docId)}/pages/${pageObjectNumber}/annotations`,

  /**
   * POST: create an annotation on a page. Body is `AnnotationDraft`,
   * response is `AnnotationCreateResult`. Same path as the full-page
   * read; the verb disambiguates.
   */
  pageAnnotationsCreate: (docId: string, pageObjectNumber: number) =>
    `/v1/documents/${encodeURIComponent(docId)}/pages/${pageObjectNumber}/annotations`,

  /**
   * PATCH/DELETE: target a single annotation by stable id. The `key`
   * segment encodes the durable identity as `obj:<n>` or `nm:<value>`
   * (see `encodeStableIdKey`); index-only refs are sent as `index:<n>:<rev>`
   * with a revision token suffix for liveness.
   */
  annotationByKey: (docId: string, pageObjectNumber: number, key: string) =>
    `/v1/documents/${encodeURIComponent(docId)}/pages/${pageObjectNumber}/annotations/${encodeURIComponent(key)}`,

  /**
   * GET: list every page in display order. Returns `PageListSnapshot`.
   * Cheap (no pagePtr is acquired); intended for a UI page-thumbnails
   * pane to learn current order + per-page revision.
   */
  pagesList: (docId: string) => `/v1/documents/${encodeURIComponent(docId)}/pages`,

  /**
   * POST: reorder pages. Body is `PageMoveInput`, response is
   * `PageMoveResult`. Page identity is the indirect `pageObjectNumber`
   * (never the index), so multiple reorder requests can be queued
   * without index-drift hazards. No per-page revision is bumped.
   */
  pagesMove: (docId: string) => `/v1/documents/${encodeURIComponent(docId)}/pages/move`,

  /**
   * POST: batch annotation reorder within a single page. Body is
   * `{ refs: AnnotationRef[]; toIndex: number }`, response is
   * `AnnotationMoveResult`. Single-annotation move is just `refs.length === 1`.
   * The page is addressed by indirect `pageObjectNumber`; refs may mix
   * stable ids (`objectNumber`/`nm`) with weak `index` refs.
   */
  pageAnnotationsMove: (docId: string, pageObjectNumber: number) =>
    `/v1/documents/${encodeURIComponent(docId)}/pages/${pageObjectNumber}/annotations/move`,

  // ---- Phase 3 doc-scoped routes ----

  /**
   * GET: open the document referenced by the doc-scoped JWT and
   * return its `DocumentHead`. The server materialises the base
   * PDF into its file cache and binds it to a worker the first
   * time this is hit.
   */
  docHead: (docId: string) => `/v1/docs/${encodeURIComponent(docId)}/head`,

  /**
   * GET: full document manifest at a specific `docVersion`. Content-
   * addressed: the URL bytes are immutable for the lifetime of the
   * version, so CDNs may cache `public, max-age=31536000, immutable`.
   * A request whose `docVersion` mismatches the current version
   * returns 404 — the SDK refetches `/head` to learn the new
   * version, then re-requests the manifest at the new URL.
   */
  docManifest: (docId: string, docVersion: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/v${docVersion}/manifest`,

  /**
   * GET: full layer manifest at a specific layer document version.
   * Never-mutated layers may fall through to the immutable base view;
   * once a layer row exists, `layers.doc_version` and `layer_pages`
   * drive the response.
   */
  layerManifest: (docId: string, layerName: string, docVersion: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/layers/${encodeURIComponent(layerName)}/v${docVersion}/manifest`,

  /**
   * GET: full plain-text extraction for a single page at a specific
   * `contentVersion`. Content-addressed; CDN may cache forever.
   * Stale-version requests return 404 and the SDK's transparent
   * retry walks `/head` → `/v:D/manifest` to learn the new
   * `contentVersion`.
   */
  docPageText: (docId: string, pageObjectNumber: number, contentVersion: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/pages/${pageObjectNumber}/v${contentVersion}/text`,

  /**
   * GET: full annotation list for a single page at a specific
   * `annotationVersion`. Same cache-control rules and 404-retry
   * semantics as `docPageText`.
   */
  docPageAnnotations: (docId: string, pageObjectNumber: number, annotationVersion: number) =>
    `/v1/docs/${encodeURIComponent(docId)}/pages/${pageObjectNumber}/v${annotationVersion}/annotations`,

  /**
   * POST: pre-warm the doc cache + worker open before any user
   * request lands. Body is `{ docId }`. Doc-scoped token required.
   */
  docWarm: '/v1/warm',
} as const;
