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
} as const;
