import { z } from 'zod';
import type {
  AnnotationListPageSnapshot,
  AnnotationListSnapshotAllPages,
} from '../annotation/AnnotationListSnapshot';
import { AnnotationDTOSchema } from '../annotation/kinds';
import type { DocumentMetadata } from '../dto/DocumentMetadata';
import type { SerializedEngineError } from '../errors/EngineError';
import { EngineErrorCode } from '../errors/EngineErrorCode';
import { AnnotationStableIdSchema, RevisionTokenSchema } from '../annotation/base.schema';
import type { PageState } from '../revision/PageState';
import type {
  AnnotationCreateResult,
  AnnotationDeleteResult,
  AnnotationMoveResult,
  AnnotationUpdateResult,
} from '../mutation/AnnotationMutationResults';
import type { AnnotationListMutationMeta } from '../mutation/AnnotationListMutationMeta';
import type { RefetchReason } from '../mutation/RefetchReason';
import type { PageListSnapshot } from '../dto/PageListSnapshot';
import type { PageMoveInput } from '../mutation/PageMoveInput';
import type { PageMoveResult } from '../mutation/PageMoveResult';

export const DocumentMetadataSchema: z.ZodType<DocumentMetadata> = z.object({
  title: z.string().nullable(),
  author: z.string().nullable(),
  subject: z.string().nullable(),
  keywords: z.string().nullable(),
  producer: z.string().nullable(),
  creator: z.string().nullable(),
  created: z.string().datetime().nullable(),
  modified: z.string().datetime().nullable(),
  trapped: z.enum(['true', 'false', 'unknown']),
  custom: z.record(z.string(), z.string()),
});

export const OpenDocumentResponseSchema = z.object({
  id: z.string(),
});
export type OpenDocumentResponse = z.infer<typeof OpenDocumentResponseSchema>;

/**
 * Wire shape of `GET /v1/docs/:docId/head`. Mirrors the server-side
 * `DocumentHead` interface; the schema is the source of truth so
 * older SDKs talking to newer servers degrade gracefully (extra
 * fields are accepted and ignored).
 */
export const DocumentHeadSchema = z.object({
  id: z.string(),
  baseSha: z.string(),
  pageCount: z.number().int().nonnegative(),
  storageSizeBytes: z.number().int().nonnegative(),
  docStructureVersion: z.number().int().positive(),
  state: z.enum(['pending', 'ready', 'failed', 'deleting']),
});
export type DocumentHead = z.infer<typeof DocumentHeadSchema>;

const engineErrorCodeValues = Object.values(EngineErrorCode) as [
  EngineErrorCode,
  ...EngineErrorCode[],
];

export const EngineErrorPayloadSchema: z.ZodType<SerializedEngineError> = z.object({
  name: z.literal('EngineError'),
  code: z.enum(engineErrorCodeValues),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const PageStateSchema: z.ZodType<PageState> = z.object({
  pageObjectNumber: z.number().int().positive(),
  pageIndex: z.number().int().nonnegative(),
  revision: RevisionTokenSchema,
  hasAnyWeakAnnotations: z.boolean(),
});

export const AnnotationListPageSnapshotSchema: z.ZodType<AnnotationListPageSnapshot> = z.object({
  pageState: PageStateSchema,
  annotations: z.array(AnnotationDTOSchema),
});

export const AnnotationListSnapshotAllPagesSchema: z.ZodType<AnnotationListSnapshotAllPages> =
  z.object({
    pages: z.array(AnnotationListPageSnapshotSchema),
  });

/**
 * Reasons a mutation tells the client its old snapshot is stale. Wire-stable;
 * extend with care (forward-compat clients accept only known values).
 */
export const RefetchReasonSchema: z.ZodType<RefetchReason> = z.enum([
  'weakRefsInvalidated',
  'externalChange',
  'pageRebuilt',
]);

/**
 * Per-page side-effect envelope every annotation mutation returns. Mirrors
 * `AnnotationListMutationMeta`. The `shouldRefetch` field is `null` when the
 * client's existing index-based references remain valid; non-null only when
 * the engine knows for sure the snapshot is stale.
 */
export const AnnotationListMutationMetaSchema: z.ZodType<AnnotationListMutationMeta> = z.object({
  pageState: PageStateSchema,
  changed: z.array(AnnotationStableIdSchema),
  weakRefsInvalidated: z.boolean(),
  shouldRefetch: z.object({ reason: RefetchReasonSchema }).nullable(),
});

export const AnnotationCreateResultSchema: z.ZodType<AnnotationCreateResult> = z.object({
  created: AnnotationDTOSchema,
  meta: AnnotationListMutationMetaSchema,
});

export const AnnotationUpdateResultSchema: z.ZodType<AnnotationUpdateResult> = z.object({
  updated: AnnotationDTOSchema,
  meta: AnnotationListMutationMetaSchema,
});

/**
 * `deleted` is nullable: a weak annotation (no /NM, no indirect object
 * number) has no durable id to report after removal. Cloud server and local
 * worker both emit `null` in that case so callers don't have to special-case
 * a sentinel.
 */
export const AnnotationDeleteResultSchema: z.ZodType<AnnotationDeleteResult> = z.object({
  deleted: AnnotationStableIdSchema.nullable(),
  meta: AnnotationListMutationMetaSchema,
});

/**
 * Batch annotation move (contiguous-block, symmetric with `pages.move`).
 * `moved` is in caller order; each `moved[i]` lives at index `toIndex + i`
 * after the move. ONE structural envelope per batch.
 */
export const AnnotationMoveResultSchema: z.ZodType<AnnotationMoveResult> = z.object({
  moved: z.array(AnnotationDTOSchema),
  meta: AnnotationListMutationMetaSchema,
});

/**
 * Snapshot of every page in display order. Pages are addressed by
 * `pageObjectNumber` everywhere except this read; the per-element
 * `pageIndex` is for rendering and is intentionally not an identity.
 */
export const PageListSnapshotSchema: z.ZodType<PageListSnapshot> = z.object({
  pages: z.array(PageStateSchema),
});

/**
 * Page reorder input. Pages are always addressed by `pageObjectNumber`;
 * `destIndex` is the insertion point in the post-removal index space.
 */
export const PageMoveInputSchema: z.ZodType<PageMoveInput> = z.object({
  pageObjectNumbers: z.array(z.number().int().positive()),
  destIndex: z.number().int().nonnegative(),
});

/**
 * Page reorder result. No revision is bumped (no doc-level revision exists,
 * and per-page revisions intentionally survive a page reorder). The full
 * post-move order is returned so callers can swap their snapshot directly.
 */
export const PageMoveResultSchema: z.ZodType<PageMoveResult> = z.object({
  pageOrder: z.array(PageStateSchema),
});
