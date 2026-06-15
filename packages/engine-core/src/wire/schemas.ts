import { z } from 'zod';

import type {
  AnnotationListPageSnapshot,
  AnnotationListSnapshotAllPages,
} from '../annotation/AnnotationListSnapshot';
import { AnnotationStableIdSchema, RevisionTokenSchema } from '../annotation/base.schema';
import { AnnotationDTOSchema } from '../annotation/kinds';
import { PdfRectSchema, PdfRotationSchema, PdfSizeSchema } from '../geometry/schemas';
import type { CachePins } from '../dto/CachePins';
import type { DocumentManifest, ManifestPage } from '../dto/DocumentManifest';
import type { DocumentMetadata } from '../dto/DocumentMetadata';
import type { MetadataPatch } from '../dto/MetadataPatch';
import type { PageGeometrySnapshot } from '../dto/PageGeometrySnapshot';
import type { PageListSnapshot } from '../dto/PageListSnapshot';
import type { PageBoxes, PageLayout } from '../dto/PageLayout';
import type { PageImageOptions, PageNetworkRenderFormat, PageRenderQuery } from '../dto/PageRender';
import type { PageTextSnapshot } from '../dto/PageTextSnapshot';
import type { PdfSaveMode } from '../dto/PdfSaveMode';
import type { DocumentSecurityState, PdfPermissionInfo } from '../engine/DocumentSecurityService';
import type { SerializedEngineError } from '../errors/EngineError';
import { EngineErrorCode } from '../errors/EngineErrorCode';
import type { AnnotationListMutationMeta } from '../mutation/AnnotationListMutationMeta';
import type {
  AnnotationCreateResult,
  AnnotationDeleteResult,
  AnnotationMoveResult,
  AnnotationUpdateResult,
} from '../mutation/AnnotationMutationResults';
import type { RefetchReason } from '../mutation/RefetchReason';
import type { PageState } from '../revision/PageState';
import type { WeakAnnotationState } from '../revision/WeakAnnotationState';
import type { PageMoveInput } from '../mutation/PageMoveInput';
import type { PageMoveResult } from '../mutation/PageMoveResult';
import type { PageStructureCache } from '../mutation/PageStructureCache';
import type { PageRotateInput } from '../mutation/PageRotateInput';
import type { PageRotateResult } from '../mutation/PageRotateResult';
import type { PageDeleteInput } from '../mutation/PageDeleteInput';
import type { PageDeleteResult } from '../mutation/PageDeleteResult';
import type { MetadataUpdateResult } from '../mutation/MetadataUpdateResult';
import type { CacheDelta, MutationMeta } from '../mutation/MutationMeta';
export type { CacheDelta, MutationMeta } from '../mutation/MutationMeta';

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

/**
 * Three-state metadata patch. Mirrors annotation patch semantics:
 * `undefined` leaves a field, `null` clears it, a value sets it. `custom`
 * is a per-key three-state map (string set / null clear / absent leave).
 */
export const MetadataPatchSchema: z.ZodType<MetadataPatch> = z
  .object({
    title: z.string().nullable().optional(),
    author: z.string().nullable().optional(),
    subject: z.string().nullable().optional(),
    keywords: z.string().nullable().optional(),
    producer: z.string().nullable().optional(),
    creator: z.string().nullable().optional(),
    created: z.string().datetime().nullable().optional(),
    modified: z.string().datetime().nullable().optional(),
    trapped: z.enum(['true', 'false', 'unknown']).optional(),
    custom: z.record(z.string(), z.string().nullable()).optional(),
  })
  .strict();

export const OpenDocumentResponseSchema = z.object({
  id: z.string(),
});
export type OpenDocumentResponse = z.infer<typeof OpenDocumentResponseSchema>;

/**
 * Wire shape of `GET /v1/docs/:docId/head`. Mirrors the server-side
 * `DocumentHead` interface; the schema is the source of truth so
 * older SDKs talking to newer servers degrade gracefully (extra
 * fields are accepted and ignored).
 *
 * `docVersion` is the single monotonic integer per doc; it bumps on
 * ANY mutation that could change the manifest's content (page list,
 * per-page content, per-page annotations, per-page weak-flag), which
 * makes `/manifest@docVersion=N` fully content-addressed and cache-friendly.
 * Phase 4 hard-codes it to `1`; Phase 5's mutation handler is what
 * actually bumps it.
 */
export const DocumentHeadSchema = z.object({
  id: z.string(),
  baseSha: z.string(),
  storageSizeBytes: z.number().int().nonnegative(),
  docVersion: z.number().int().positive(),
  state: z.enum(['pending', 'ready', 'failed', 'deleting']),
  encryption: z.object({
    state: z.enum(['unknown', 'none', 'encrypted', 'unsupported']),
    requiresPassword: z.boolean().nullable(),
  }),
  permissions: z.object({
    known: z.boolean(),
    bits: z.number().int().nonnegative().nullable(),
    allAllowed: z.boolean().nullable(),
    openedAs: z.enum(['none', 'user', 'owner']).nullable(),
    securityHandlerRevision: z.number().int().nullable(),
    canUpgradeToOwner: z.boolean(),
  }),
  access: z.object({
    required: z.boolean(),
    reasons: z.array(z.enum(['password', 'cdn', 'permissions-unknown'])),
    endpoint: z.string().optional(),
  }),
});
export type DocumentHead = z.infer<typeof DocumentHeadSchema>;

export const AccessRequestSchema = z.object({
  docId: z.string().min(1),
  layerName: z.string().min(1).optional(),
  password: z.string().optional(),
  passwordGrant: z.string().optional(),
  mode: z.enum(['any', 'owner']).optional(),
});
export type AccessRequest = z.infer<typeof AccessRequestSchema>;

/**
 * Typed boolean view of the PDF user-access permission word. Names
 * mirror the `PdfBits` shape in @embedpdf/engine-core/auth/scope; ISO
 * bit numbers (3, 4, 5, 6, 9, 10, 11, 12).
 */
const PdfBitsObjectSchema = z.object({
  bit3: z.boolean(),
  bit4: z.boolean(),
  bit5: z.boolean(),
  bit6: z.boolean(),
  bit9: z.boolean(),
  bit10: z.boolean(),
  bit11: z.boolean(),
  bit12: z.boolean(),
});

/**
 * Capability-shaped advisory for the client UI. Mirrors
 * `PdfPermissionAdvisory` in @embedpdf/engine-core/runtime; one
 * boolean per UI badge.
 */
const PdfPermissionAdvisoryObjectSchema = z.object({
  canPrint: z.boolean(),
  canPrintHigh: z.boolean(),
  canCopy: z.boolean(),
  canAnnotate: z.boolean(),
  canFillForms: z.boolean(),
  canModifyForms: z.boolean(),
  canModifyPages: z.boolean(),
  canAssemble: z.boolean(),
});

const PdfPermissionInfoObjectSchema: z.ZodType<PdfPermissionInfo> = z.object({
  known: z.boolean(),
  allAllowed: z.boolean().nullable(),
  bits: z.number().int().nonnegative().nullable(),
  openedAs: z.enum(['none', 'user', 'owner']).nullable(),
  securityHandlerRevision: z.number().int().nullable(),
  // Enriched fields from /access (commit 14). Optional so /head, which
  // doesn't always populate them, stays valid against this schema too.
  flags: PdfBitsObjectSchema.optional(),
  advisory: PdfPermissionAdvisoryObjectSchema.optional(),
});

const PdfPermissionInfoSchema = PdfPermissionInfoObjectSchema.nullable();

export const DocumentSecurityStateSchema: z.ZodType<DocumentSecurityState> = z.object({
  encryption: z.object({
    state: z.enum(['unknown', 'none', 'encrypted', 'unsupported']),
    requiresPassword: z.boolean().nullable(),
  }),
  permissions: z.object({
    known: z.boolean(),
    bits: z.number().int().nonnegative().nullable(),
    allAllowed: z.boolean().nullable(),
    openedAs: z.enum(['none', 'user', 'owner']).nullable(),
    securityHandlerRevision: z.number().int().nullable(),
    canUpgradeToOwner: z.boolean(),
  }),
  access: z.object({
    required: z.boolean(),
    reasons: z.array(z.enum(['password', 'cdn', 'permissions-unknown'])),
    endpoint: z.string().optional(),
  }),
});

export const AccessResponseSchema = z.object({
  security: DocumentSecurityStateSchema,
  cdn: z.object({
    adapter: z.enum(['none', 'cloudfront', 'cloud-cdn', 'bunny', 'azure-fd', 'custom-hmac']),
    expiresAt: z.number().int().positive(),
    cache: z.object({
      scope: z.enum(['browser-private', 'edge-shared']),
      immutableVersionedReads: z.boolean(),
    }),
    baseUrlOverrides: z.record(z.string(), z.string()).nullable(),
    authHeader: z.object({ name: z.string(), value: z.string() }).nullable(),
    // Optional signing channels — each adapter populates the subset it uses
    signedQueryParams: z.record(z.string(), z.string()).nullable(),
    signedCookies: z
      .array(
        z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string().optional(),
          path: z.string().optional(),
          expires: z.number().int().optional(),
        }),
      )
      .nullable(),
    signedPathPolicies: z
      .array(
        z.object({
          pathPrefix: z.string(),
          queryParams: z.record(z.string(), z.string()),
        }),
      )
      .nullable(),
  }),
  passwordGrant: z.string().nullable(),
  pdfPermissions: PdfPermissionInfoSchema,
  scope: z.array(z.string()),
  /**
   * Concrete capability set granted to this caller after expanding
   * `pdf.permissions` and applying resolver implication rules. Client
   * UI should drive feature visibility off this, not off raw `scope`.
   * Always present in /access responses (server populates from
   * `expandRawScope`). Sorted alphabetically for stable change
   * detection.
   */
  effectiveScope: z.array(z.string()),
  identity: z.object({
    user_id: z.string().optional(),
    group_id: z.string().optional(),
    groups: z.array(z.string()).optional(),
    display_name: z.string().optional(),
  }),
  originPasswordPolicy: z.object({
    mode: z.enum(['not-needed', 'client-retry', 'server-session']),
  }),
  expiresAt: z.number().int().positive(),
});
export type AccessResponse = z.infer<typeof AccessResponseSchema>;

export const PdfSaveModeSchema: z.ZodType<PdfSaveMode> = z.enum(['incremental', 'rewrite']);

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

export const WeakAnnotationStateSchema: z.ZodType<WeakAnnotationState> = z.discriminatedUnion(
  'kind',
  [
    z.object({ kind: z.literal('unknown') }),
    z.object({
      kind: z.literal('known'),
      hasAnyWeakAnnotations: z.boolean(),
    }),
  ],
);

export const PageStateSchema: z.ZodType<PageState> = z.object({
  pageObjectNumber: z.number().int().positive(),
  revision: RevisionTokenSchema,
  weakAnnotationState: WeakAnnotationStateSchema,
});

export const CachePinsSchema: z.ZodType<CachePins> = z.object({
  contentVersion: z.number().int().positive(),
  annotationVersion: z.number().int().positive(),
});

/**
 * Per-page envelope inside `DocumentManifest`. Carries the full
 * `PageState` plus the cache-busting integers the SDK embeds in
 * leaf URLs (`/pages/:pon/text@contentVersion=N`, `/pages/:pon/annotations@annotationVersion=N`).
 *
 * `contentVersion` bumps when the page's content stream changes
 * (text, page reorder doesn't, the pon is durable). `annotationVersion`
 * bumps when /Annots gains/loses entries or when a tracked annotation
 * mutates. `hasWeakAnnotations` is hoisted from `PageState` so the
 * SDK can decide whether to display a "stale-on-reorder" badge
 * without re-fetching the page.
 *
 * Phase 4 hard-codes all three to (1, 1, false); Phase 5's
 * `layer_pages` table drives the real values.
 */
export const ManifestPageSchema: z.ZodType<ManifestPage> = z
  .object({
    state: PageStateSchema,
    cache: CachePinsSchema,
  })
  .superRefine((page, ctx) => {
    if (page.state.weakAnnotationState.kind !== 'known') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['state', 'weakAnnotationState'],
        message: 'manifest pages must have a known weak annotation state',
      });
    }
  }) as z.ZodType<ManifestPage>;
export type { ManifestPage } from '../dto/DocumentManifest';

/**
 * Wire shape of `GET /v1/docs/:docId/manifest@docVersion=N`. Content-addressed
 * by `docVersion`; safe to cache with `Cache-Control: public,
 * max-age=31536000, immutable`.
 */
export const DocumentManifestSchema: z.ZodType<DocumentManifest> = z.object({
  docVersion: z.number().int().positive(),
  layoutVersion: z.number().int().positive(),
  metadataVersion: z.number().int().positive(),
  auditHead: z.number().int().nonnegative(),
  baseSha: z.string(),
  pages: z.array(ManifestPageSchema),
});
export type { DocumentManifest } from '../dto/DocumentManifest';

export const AnnotationListPageSnapshotSchema: z.ZodType<AnnotationListPageSnapshot> = z.object({
  pageState: PageStateSchema,
  annotations: z.array(AnnotationDTOSchema),
});

export const AnnotationListSnapshotAllPagesSchema: z.ZodType<AnnotationListSnapshotAllPages> =
  z.object({
    pages: z.array(AnnotationListPageSnapshotSchema),
  });

/**
 * Wire shape of `GET /v1/docs/:docId/pages/:pon/text@contentVersion=N` and the
 * `pages.text` worker result. Carries the same `pageState` envelope
 * every page-scoped read returns, plus the full plain-text extraction
 * in display order and PDFium's char-count (which may exceed
 * `text.length / 1` when astral-plane characters are present).
 */
export const PageTextSnapshotSchema: z.ZodType<PageTextSnapshot> = z.object({
  text: z.string(),
  charCount: z.number().int().nonnegative(),
});

export const PageGeometryGlyphSchema = z.object({
  looseBox: PdfRectSchema,
  flags: z.number().int().nonnegative(),
  tightBox: PdfRectSchema.optional(),
});

export const PageGeometryRunSchema = z.object({
  rect: PdfRectSchema,
  charStart: z.number().int().nonnegative(),
  glyphs: z.array(PageGeometryGlyphSchema),
  fontSize: z.number().optional(),
});

export const PageGeometrySnapshotSchema: z.ZodType<PageGeometrySnapshot> = z.object({
  runs: z.array(PageGeometryRunSchema),
});

export const PageNetworkRenderFormatSchema: z.ZodType<PageNetworkRenderFormat> = z.enum([
  'png',
  'webp',
]);

/**
 * Wire schema for the cloud render endpoints, applied to the **nested**
 * shape produced by `unflatten(...)` of the parsed token or query string.
 *
 * Adding a new render option is one change here (a new field plus any
 * cross-field rule in `superRefine`) plus one entry in
 * `RenderTokenSchema.fields`. The token codec, flatten/unflatten helpers,
 * route handlers, and SDK URL builder are all generic and pick the new
 * field up automatically.
 *
 * Coercion: token fields and query strings both arrive as strings, so every
 * scalar uses `z.coerce.*`. Discriminated unions on `viewport.kind` and
 * `target.kind` enforce viewport / rect coherence by construction — no
 * superRefine for "fields must appear together" rules.
 */

const RenderViewportSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('width'),
      width: z.coerce.number().positive().finite(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('scale'),
      scale: z.coerce.number().positive().finite().optional(),
    })
    .strict(),
]);

const RenderTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page') }).strict(),
  z
    .object({
      kind: z.literal('rect'),
      rect: z
        .object({
          left: z.coerce.number().finite(),
          bottom: z.coerce.number().finite(),
          right: z.coerce.number().finite(),
          top: z.coerce.number().finite(),
        })
        .strict(),
    })
    .strict(),
]);

const RenderRotationSchema = z.preprocess(
  (raw) => (raw === undefined ? undefined : Number(raw)),
  z.number().refine((n) => n === 0 || n === 90 || n === 180 || n === 270, {
    message: 'render rotation must be 0, 90, 180, or 270',
  }),
);

const RenderBackgroundSchema = z.enum(['white', 'transparent']);

const RenderQualitySchema = z.coerce.number().int().min(1).max(100);

// z.coerce.boolean() uses Boolean(value) which turns the string "false" into
// true. Explicit string→boolean handling is the only safe way to read this
// from a query string or token value.
const RenderIncludeAnnotationsSchema = z.preprocess((raw) => {
  if (raw === undefined) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return raw;
}, z.boolean());

export const PageRenderQuerySchema = z
  .object({
    contentVersion: z.coerce.number().int().positive().optional(),
    annotationVersion: z.coerce.number().int().positive().optional(),
    format: PageNetworkRenderFormatSchema.optional(),
    includeAnnotations: RenderIncludeAnnotationsSchema.optional(),
    viewport: RenderViewportSchema.optional(),
    target: RenderTargetSchema.optional(),
    rotation: RenderRotationSchema.optional(),
    background: RenderBackgroundSchema.optional(),
    quality: RenderQualitySchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.contentVersion !== undefined && v.includeAnnotations === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['includeAnnotations'],
        message: 'versioned render requires includeAnnotations',
      });
    }
    if (v.contentVersion !== undefined && v.format === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['format'],
        message: 'versioned render requires format',
      });
    }
    if (v.annotationVersion !== undefined && v.contentVersion === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['annotationVersion'],
        message: 'annotationVersion requires contentVersion',
      });
    }
    const includeAnnotations = v.includeAnnotations ?? true;
    if (v.contentVersion !== undefined && includeAnnotations && v.annotationVersion === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['annotationVersion'],
        message: 'versioned render requires annotationVersion when includeAnnotations is true',
      });
    }
    if (!includeAnnotations && v.annotationVersion !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['annotationVersion'],
        message: 'annotationVersion is invalid when includeAnnotations is false',
      });
    }
  })
  .transform((v) => {
    const options: PageImageOptions = {
      ...(v.target ? { target: v.target } : {}),
      ...(v.viewport ? { viewport: v.viewport } : {}),
      ...(v.rotation !== undefined ? { rotation: v.rotation } : {}),
      ...(v.background !== undefined ? { background: v.background } : {}),
      ...(v.quality !== undefined ? { quality: v.quality } : {}),
      ...(v.format !== undefined ? { format: v.format } : {}),
      includeAnnotations: v.includeAnnotations ?? true,
    };
    return {
      options,
      ...(v.contentVersion !== undefined ? { contentVersion: v.contentVersion } : {}),
      ...(v.annotationVersion !== undefined ? { annotationVersion: v.annotationVersion } : {}),
    };
  }) as unknown as z.ZodType<PageRenderQuery>;

/**
 * Reasons a mutation tells the client its old snapshot is stale. Wire-stable;
 * extend with care (forward-compat clients accept only known values).
 */
export const RefetchReasonSchema: z.ZodType<RefetchReason> = z.enum([
  'weakRefsInvalidated',
  'externalChange',
  'pageRebuilt',
]);

export const CacheDeltaSchema: z.ZodType<CacheDelta> = z.object({
  previousDocVersion: z.number().int().positive(),
  docVersion: z.number().int().positive(),
  pages: z.array(
    z.object({
      pageObjectNumber: z.number().int().positive(),
      cache: CachePinsSchema,
    }),
  ),
});

export const MutationMetaSchema: z.ZodType<MutationMeta> = z.object({
  affectedPages: z.array(PageStateSchema),
  cacheDelta: CacheDeltaSchema.nullable(),
});

/**
 * Per-page side-effect envelope every annotation mutation returns. Mirrors
 * `AnnotationListMutationMeta`. The `shouldRefetch` field is `null` when the
 * client's existing index-based references remain valid; non-null only when
 * the engine knows for sure the snapshot is stale.
 */
export const AnnotationListMutationMetaSchema: z.ZodType<AnnotationListMutationMeta> = z.object({
  affectedPages: z.array(PageStateSchema),
  cacheDelta: CacheDeltaSchema.nullable(),
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
 * A PDF box in PDF user space as a `PdfRect` (`{ left, bottom, right, top }`,
 * y-up edges, un-rotated, not origin-normalized). Re-exported from the
 * canonical geometry schema so the wire and the runtime agree.
 */
export { PdfRectSchema };

export const PageBoxesSchema: z.ZodType<PageBoxes> = z.object({
  media: PdfRectSchema,
  crop: PdfRectSchema,
  bleed: PdfRectSchema.optional(),
  trim: PdfRectSchema.optional(),
  art: PdfRectSchema.optional(),
});

/**
 * Pure geometry for one page (`pages.list()` element). No annotation
 * liveness — that lives on annotation reads and the manifest.
 */
export const PageLayoutSchema: z.ZodType<PageLayout> = z.object({
  index: z.number().int().nonnegative(),
  pageObjectNumber: z.number().int().positive(),
  label: z.string().nullable(),
  size: PdfSizeSchema,
  rotation: PdfRotationSchema,
  userUnit: z.number().positive(),
  boxes: PageBoxesSchema,
});

/**
 * Snapshot of every page in display order. Pages are addressed by
 * `pageObjectNumber` everywhere except the per-element `index`, which is
 * display order and intentionally not an identity. Carries geometry only.
 */
export const PageListSnapshotSchema: z.ZodType<PageListSnapshot> = z.object({
  pageCount: z.number().int().nonnegative(),
  pages: z.array(PageLayoutSchema),
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
 * Coherence pins shared by every page-STRUCTURE result (move/rotate/delete) —
 * see `PageStructureCache`. Nullable at each use site (local engines).
 */
export const PageStructureCacheSchema: z.ZodType<PageStructureCache> = z.object({
  previousDocVersion: z.number().int().nonnegative(),
  docVersion: z.number().int().positive(),
  layoutVersion: z.number().int().positive(),
});

/**
 * Page reorder result. No revision is bumped (no doc-level revision exists,
 * and per-page revisions intentionally survive a page reorder). The full
 * post-move order is returned so callers can swap their snapshot directly.
 */
export const PageMoveResultSchema: z.ZodType<PageMoveResult> = z.object({
  layout: PageListSnapshotSchema,
  cache: PageStructureCacheSchema.nullable(),
});

/**
 * Page rotate input. ABSOLUTE rotation (idempotent — see `PageRotateInput`),
 * one value applied to every listed page.
 */
export const PageRotateInputSchema: z.ZodType<PageRotateInput> = z.object({
  pageObjectNumbers: z.array(z.number().int().positive()),
  rotation: PdfRotationSchema,
});

/**
 * Page rotate result. Rotation is presentation metadata over normalized
 * content: nothing per-page invalidates; the new `layout` carries the
 * rotation values (see `PageRotateResult`).
 */
export const PageRotateResultSchema: z.ZodType<PageRotateResult> = z.object({
  layout: PageListSnapshotSchema,
  cache: PageStructureCacheSchema.nullable(),
});

/** Page delete input. Deleting every page is rejected server/worker-side. */
export const PageDeleteInputSchema: z.ZodType<PageDeleteInput> = z.object({
  pageObjectNumbers: z.array(z.number().int().positive()),
});

/**
 * Page delete result. Deleted PONs are retired (never recycled); surviving
 * pages keep identity + revisions (see `PageDeleteResult`).
 */
export const PageDeleteResultSchema: z.ZodType<PageDeleteResult> = z.object({
  layout: PageListSnapshotSchema,
  cache: PageStructureCacheSchema.nullable(),
});

/**
 * Metadata write result. The Info dict is rewritten in place, so the
 * result returns the re-read `metadata` plus cloud coherence pins. No
 * `layoutVersion` is touched — a metadata edit bumps only `docVersion`
 * and `metadataVersion`. `cache` is `null` for local engines.
 */
export const MetadataUpdateResultSchema: z.ZodType<MetadataUpdateResult> = z.object({
  metadata: DocumentMetadataSchema,
  cache: z
    .object({
      previousDocVersion: z.number().int().nonnegative(),
      docVersion: z.number().int().positive(),
      metadataVersion: z.number().int().positive(),
    })
    .nullable(),
});

export const WeakAnnotationSessionResponseSchema = z.object({
  sessionId: z.string().min(1),
  expiresAt: z.number().int().positive(),
  heartbeatIntervalMs: z.number().int().positive(),
  pageObjectNumbers: z.array(z.number().int().positive()),
});
export type WeakAnnotationSessionResponse = z.infer<typeof WeakAnnotationSessionResponseSchema>;

export const WeakAnnotationSessionPagesRequestSchema = z.object({
  pageObjectNumbers: z.array(z.number().int().positive()).transform((pages) => [...new Set(pages)]),
});
export type WeakAnnotationSessionPagesRequest = z.infer<
  typeof WeakAnnotationSessionPagesRequestSchema
>;
