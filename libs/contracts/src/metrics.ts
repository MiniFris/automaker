import { z } from 'zod';

const labels = z.record(z.string(), z.string().max(160));
const count = z.number().int().nonnegative();
export const MetricsSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  uptimeMs: z.number().nonnegative(),
  providerActiveQueries: count,
  droppedMeasurements: count,
  seriesLimit: z.literal(2048),
  runtimeGauges: z
    .array(z.object({ name: z.string(), value: count.nullable() }))
    .max(32)
    .optional(),
  counters: z.array(z.object({ name: z.string(), labels, value: count })).max(2048),
  observations: z
    .array(
      z.object({
        name: z.string(),
        labels,
        count,
        sum: z.number().nonnegative(),
        min: z.number().nonnegative(),
        max: z.number().nonnegative(),
        buckets: z.array(z.object({ upperBound: z.number().positive(), count })).length(11),
      })
    )
    .max(2048),
});
export type MetricsSnapshot = z.infer<typeof MetricsSnapshotSchema>;
