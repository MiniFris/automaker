import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string().datetime(),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const HealthEnvironmentResponseSchema = z.object({
  isContainerized: z.boolean(),
  skipSandboxWarning: z.boolean().optional(),
});
export const LivenessResponseSchema = HealthResponseSchema.omit({ version: true });
export const ReadinessResponseSchema = z.object({
  status: z.literal('ready'),
  timestamp: z.string().datetime(),
});
export const DetailedHealthResponseSchema = HealthResponseSchema.extend({
  uptime: z.number().nonnegative(),
  memory: z
    .object({
      rss: z.number().nonnegative(),
      heapTotal: z.number().nonnegative(),
      heapUsed: z.number().nonnegative(),
      external: z.number().nonnegative(),
      arrayBuffers: z.number().nonnegative(),
    })
    .passthrough(),
  dataDir: z.string(),
  auth: z.object({ enabled: z.boolean(), method: z.enum(['disabled', 'api_key_or_session']) }),
  env: z.object({ nodeVersion: z.string(), platform: z.string(), arch: z.string() }),
});
