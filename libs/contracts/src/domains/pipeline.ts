import { z } from 'zod';

const ProjectPath = z.string().min(1);
const PipelineStepInput = z
  .object({
    name: z.string().min(1),
    order: z.number(),
    instructions: z.string(),
    colorClass: z.string(),
  })
  .passthrough();
const PipelineStep = PipelineStepInput.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PipelineProjectSchema = z.object({ projectPath: ProjectPath });
export const PipelineSaveSchema = z.object({
  projectPath: ProjectPath,
  config: z.object({ version: z.literal(1), steps: z.array(PipelineStep) }).passthrough(),
});
export const PipelineAddSchema = z.object({
  projectPath: ProjectPath,
  step: PipelineStepInput,
});
export const PipelineUpdateSchema = z.object({
  projectPath: ProjectPath,
  stepId: z.string().min(1),
  updates: PipelineStep.partial().refine((value) => Object.keys(value).length > 0),
});
export const PipelineDeleteSchema = z.object({
  projectPath: ProjectPath,
  stepId: z.string().min(1),
});
export const PipelineReorderSchema = z.object({
  projectPath: ProjectPath,
  stepIds: z.array(z.string()),
});

export type PipelineProjectRequest = z.infer<typeof PipelineProjectSchema>;
export type PipelineSaveRequest = z.infer<typeof PipelineSaveSchema>;
export type PipelineAddRequest = z.infer<typeof PipelineAddSchema>;
export type PipelineUpdateRequest = z.infer<typeof PipelineUpdateSchema>;
export type PipelineDeleteRequest = z.infer<typeof PipelineDeleteSchema>;
export type PipelineReorderRequest = z.infer<typeof PipelineReorderSchema>;

// Reads intentionally preserve historical config dictionaries. Mutations own
// newly generated identity/timestamps, while updates preserve stored extensions.
export const PipelineConfigResponseSchema = z.looseObject({
  success: z.literal(true),
  config: z.record(z.string(), z.unknown()),
});
export const PipelineMutationResponseSchema = z.looseObject({ success: z.literal(true) });
export const PipelineCreatedStepResponseSchema = z.looseObject({
  success: z.literal(true),
  step: PipelineStep,
});
export const PipelineUpdatedStepResponseSchema = z.looseObject({
  success: z.literal(true),
  step: z.looseObject({ id: z.string(), updatedAt: z.string() }),
});
export type PipelineConfigResponse = z.infer<typeof PipelineConfigResponseSchema>;
export type PipelineCreatedStepResponse = z.infer<typeof PipelineCreatedStepResponseSchema>;
export type PipelineUpdatedStepResponse = z.infer<typeof PipelineUpdatedStepResponseSchema>;
