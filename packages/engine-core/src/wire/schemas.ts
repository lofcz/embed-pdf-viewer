import { z } from 'zod';
import type { DocumentMetadata } from '../dto/DocumentMetadata';
import type { SerializedEngineError } from '../errors/EngineError';
import { EngineErrorCode } from '../errors/EngineErrorCode';

export const DocumentMetadataSchema: z.ZodType<DocumentMetadata> = z.object({
  title: z.string().nullable(),
  author: z.string().nullable(),
  subject: z.string().nullable(),
  keywords: z.string().nullable(),
  producer: z.string().nullable(),
  creator: z.string().nullable(),
  creationDate: z.string().nullable(),
  modificationDate: z.string().nullable(),
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
