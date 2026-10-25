import { z } from 'zod';

export const RunningAgentResponseRecordSchema = z.looseObject({
  featureId: z.string(),
  projectPath: z.string(),
  projectName: z.string(),
  isAutoMode: z.boolean(),
  kind: z.string().nullish(),
  sessionId: z.string().nullish(),
  workingDirectory: z.string().nullish(),
  model: z.string().nullish(),
  provider: z.string().nullish(),
  // FeatureData permits arbitrary JSON here and the read model projects it unchanged.
  title: z.unknown().optional(),
  description: z.unknown().optional(),
});

export const RunningAgentsResponseSchema = z
  .looseObject({
    success: z.literal(true),
    runningAgents: z.array(RunningAgentResponseRecordSchema),
    totalCount: z.number().int().nonnegative(),
  })
  .refine(
    (value) => value.totalCount === value.runningAgents.length,
    'Running agent count does not match records.'
  );

export type RunningAgentResponseRecord = z.infer<typeof RunningAgentResponseRecordSchema>;
export type RunningAgentsResponse = z.infer<typeof RunningAgentsResponseSchema>;
