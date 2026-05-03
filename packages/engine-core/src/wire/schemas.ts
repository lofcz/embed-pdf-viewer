import { z } from 'zod';
import type {
  AnnotationListPageSnapshot,
  AnnotationListSnapshotAllPages,
} from '../annotation/AnnotationListSnapshot';
import { AnnotationDTOSchema } from '../annotation/kinds';
import type { DocumentMetadata } from '../dto/DocumentMetadata';
import type { SerializedEngineError } from '../errors/EngineError';
import { EngineErrorCode } from '../errors/EngineErrorCode';
import { RevisionTokenSchema } from '../annotation/base.schema';
import type { PageState } from '../revision/PageState';

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
