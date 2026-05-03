/**
 * Single source of truth for cloud HTTP paths. Both engine-cloud and
 * @embedpdf/server import these so they cannot drift.
 */
export const wirePaths = {
  documents: '/v1/documents',
  document: (docId: string) => `/v1/documents/${encodeURIComponent(docId)}`,
  metadata: (docId: string) => `/v1/documents/${encodeURIComponent(docId)}/metadata`,
} as const;
