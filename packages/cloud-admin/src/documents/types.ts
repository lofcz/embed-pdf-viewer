export type {
  DedupMode,
  AdminDocumentRecord as DocumentRecord,
  DocumentState,
  AdminDocumentInitResponse as InitResponse,
  AdminInitUpload as InitResponseUpload,
  AdminDocumentCommitResponse as CommitResponse,
  AdminDocumentListResponse as ListResponse,
  AdminDocumentResponse as DocumentResponse,
  AdminErrorPayload,
} from '@embedpdf/cloud-api';

export type InitResponseCreatedOrResumed = Extract<
  import('@embedpdf/cloud-api').AdminDocumentInitResponse,
  { tag: 'created' | 'resumed' }
>;

export type InitResponseDeduped = Extract<
  import('@embedpdf/cloud-api').AdminDocumentInitResponse,
  { tag: 'deduped' }
>;
