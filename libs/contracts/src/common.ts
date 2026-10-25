import { z } from 'zod';

export const NonEmptyStringSchema = z.string().trim().min(1);
export const EntityIdSchema = NonEmptyStringSchema.max(512);

// Preserve the existing UTC wire format: seconds were optional before Zod 4.6.
export const UtcDateTimeSchema = z
  .union([z.iso.datetime(), z.iso.datetime({ precision: -1 })])
  .meta({ type: 'string', format: 'date-time' });

// Paths remain platform-neutral at the transport boundary. The server's path
// sandbox is still authoritative for resolving and authorizing them.
export const ProjectPathSchema = NonEmptyStringSchema.max(32_768);
export const FeatureIdSchema = EntityIdSchema.regex(/^[^/\\\0]+$/);
export const ProviderIdSchema = EntityIdSchema.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const ExecutionSelectionSchema = z
  .object({
    type: z.enum(['local', 'docker', 'ssh', 'memory']),
    targetId: EntityIdSchema.optional(),
  })
  .strict();

export const ErrorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: NonEmptyStringSchema,
  code: NonEmptyStringSchema.optional(),
  errorCode: NonEmptyStringSchema.optional(),
  correlationId: NonEmptyStringSchema.optional(),
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
