import { z } from 'zod';

export const NonEmptyStringSchema = z.string().trim().min(1);
export const EntityIdSchema = NonEmptyStringSchema.max(512);

// Paths remain platform-neutral at the transport boundary. The server's path
// sandbox is still authoritative for resolving and authorizing them.
export const ProjectPathSchema = NonEmptyStringSchema.max(32_768);

export const ErrorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: NonEmptyStringSchema,
  code: NonEmptyStringSchema.optional(),
  details: z.unknown().optional(),
});

export const SuccessEnvelopeSchema = z.object({
  success: z.literal(true),
});

export const PaginationQuerySchema = z.object({
  cursor: NonEmptyStringSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export const PaginationMetaSchema = z.object({
  nextCursor: NonEmptyStringSchema.nullable(),
  hasMore: z.boolean(),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type SuccessEnvelope = z.infer<typeof SuccessEnvelopeSchema>;
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;
