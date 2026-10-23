import { z } from 'zod';
import { ProjectPathSchema } from './common.js';

// Settings and projects
export const ProjectSettingsReadSchema = z.object({ projectPath: ProjectPathSchema }).strict();
export const DiscoverAgentsSchema = z
  .object({
    projectPath: ProjectPathSchema.optional(),
    sources: z
      .array(z.enum(['user', 'project']))
      .max(2)
      .optional(),
  })
  .strict();
export const ModelTimeoutUpdateSchema = z.object({ timeouts: z.unknown() }).strict();
export const GlobalSettingsUpdateSchema = z.record(z.string(), z.unknown());
export const CredentialsUpdateSchema = z.record(z.string(), z.unknown());
export const ProjectSettingsUpdateSchema = z
  .object({ projectPath: ProjectPathSchema, updates: z.record(z.string(), z.unknown()) })
  .strict();
export const LocalStorageMigrationRequestSchema = z
  .object({
    data: z
      .object({
        'automaker-storage': z.string().optional(),
        'automaker-setup': z.string().optional(),
        'worktree-panel-collapsed': z.string().optional(),
        'file-browser-recent-folders': z.string().optional(),
        'automaker:lastProjectDir': z.string().optional(),
      })
      .strict(),
  })
  .strict();
export const DirectSettingsMutationSchema = z.record(z.string(), z.unknown());
export type ProjectSettingsRead = z.infer<typeof ProjectSettingsReadSchema>;
export type DiscoverAgentsRequest = z.infer<typeof DiscoverAgentsSchema>;
export type ModelTimeoutUpdate = z.infer<typeof ModelTimeoutUpdateSchema>;
export type CredentialsUpdate = z.infer<typeof CredentialsUpdateSchema>;
export type ProjectSettingsUpdate = z.infer<typeof ProjectSettingsUpdateSchema>;
export type LocalStorageMigrationRequest = z.infer<typeof LocalStorageMigrationRequestSchema>;

export const ProjectsOverviewResponseSchema = z
  .object({
    success: z.literal(true),
    projects: z.array(z.record(z.string(), z.unknown())),
    aggregate: z.record(z.string(), z.unknown()),
  })
  .passthrough();
export type ProjectsOverviewResponse = z.infer<typeof ProjectsOverviewResponseSchema>;

// Features
export const ProjectFeatureIdSchema = z.string().trim().min(1).max(255);
export const ProjectFeatureSchema = z
  .object({ projectPath: ProjectPathSchema, featureId: ProjectFeatureIdSchema })
  .strict();
export const FeatureListSchema = z.object({ projectPath: ProjectPathSchema }).strict();
export const FeatureExportSchema = z
  .object({
    projectPath: ProjectPathSchema,
    featureIds: z.array(ProjectFeatureIdSchema).max(10_000).optional(),
    format: z.enum(['json', 'yaml']).default('json'),
    includeHistory: z.boolean().default(true),
    includePlanSpec: z.boolean().default(true),
    category: z.string().max(255).optional(),
    status: z.string().max(64).optional(),
    prettyPrint: z.boolean().default(true),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const FeatureConflictCheckSchema = z
  .object({
    projectPath: ProjectPathSchema,
    data: z
      .string()
      .min(1)
      .max(50 * 1024 * 1024),
  })
  .strict();
const FeatureDataSchema = z.object({}).catchall(z.unknown());
export const FeatureCreateSchema = z
  .object({ projectPath: ProjectPathSchema, feature: FeatureDataSchema })
  .strict();
export const FeatureUpdateSchema = z
  .object({
    projectPath: ProjectPathSchema,
    featureId: ProjectFeatureIdSchema,
    updates: FeatureDataSchema.refine((value) => Object.keys(value).length > 0, {
      message: 'updates must contain at least one field',
    }),
    descriptionHistorySource: z.enum(['enhance', 'edit']).optional(),
    enhancementMode: z
      .enum(['improve', 'technical', 'simplify', 'acceptance', 'ux-reviewer'])
      .optional(),
    preEnhancementDescription: z.string().max(1_000_000).optional(),
  })
  .strict();
export const FeatureBulkUpdateSchema = z
  .object({
    projectPath: ProjectPathSchema,
    featureIds: z.array(ProjectFeatureIdSchema).min(1).max(10_000),
    updates: FeatureDataSchema.refine((value) => Object.keys(value).length > 0, {
      message: 'updates must contain at least one field',
    }),
  })
  .strict();
export const FeatureBulkDeleteSchema = z
  .object({
    projectPath: ProjectPathSchema,
    featureIds: z.array(ProjectFeatureIdSchema).min(1).max(10_000),
  })
  .strict();
export const FeatureImportSchema = z
  .object({
    projectPath: ProjectPathSchema,
    data: z
      .string()
      .min(1)
      .max(50 * 1024 * 1024),
    overwrite: z.boolean().default(false),
    preserveBranchInfo: z.boolean().default(false),
    targetCategory: z.string().max(255).optional(),
  })
  .strict();
export const FeatureTitleSchema = z
  .object({
    description: z.string().trim().min(1).max(1_000_000),
    projectPath: ProjectPathSchema.optional(),
  })
  .strict();
export const OrphanResolveActionSchema = z.enum(['delete', 'create-worktree', 'move-to-branch']);
export const OrphanResolveSchema = z
  .object({
    projectPath: ProjectPathSchema,
    featureId: ProjectFeatureIdSchema,
    action: OrphanResolveActionSchema,
    targetBranch: z.string().trim().min(1).max(255).nullable().optional(),
  })
  .strict();
export const OrphanBulkResolveSchema = z
  .object({
    projectPath: ProjectPathSchema,
    featureIds: z.array(ProjectFeatureIdSchema).min(1).max(10_000),
    action: OrphanResolveActionSchema,
    targetBranch: z.string().trim().min(1).max(255).nullable().optional(),
  })
  .strict();
export type ProjectFeatureRequest = z.infer<typeof ProjectFeatureSchema>;
export type FeatureListRequest = z.infer<typeof FeatureListSchema>;
export type FeatureExportRequest = z.infer<typeof FeatureExportSchema>;
export type FeatureConflictCheckRequest = z.infer<typeof FeatureConflictCheckSchema>;
export type FeatureCreateRequest = z.infer<typeof FeatureCreateSchema>;
export type FeatureUpdateRequest = z.infer<typeof FeatureUpdateSchema>;
export type FeatureBulkUpdateRequest = z.infer<typeof FeatureBulkUpdateSchema>;
export type FeatureBulkDeleteRequest = z.infer<typeof FeatureBulkDeleteSchema>;
export type FeatureImportRequest = z.infer<typeof FeatureImportSchema>;
export type FeatureTitleRequest = z.infer<typeof FeatureTitleSchema>;
export type OrphanResolveRequest = z.infer<typeof OrphanResolveSchema>;
export type OrphanBulkResolveRequest = z.infer<typeof OrphanBulkResolveSchema>;

// Sessions
export const SessionIdSchema = z.string().trim().min(1).max(255);
export const SessionParamsSchema = z.object({ sessionId: SessionIdSchema }).strict();
export const SessionListQuerySchema = z
  .object({ includeArchived: z.enum(['true', 'false']).optional().default('false') })
  .strict();
export const SessionCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    projectPath: ProjectPathSchema.optional(),
    workingDirectory: ProjectPathSchema.optional(),
    model: z.string().trim().min(1).max(255).optional(),
    providerId: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
export const SessionUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    model: z.string().trim().min(1).max(255).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one update field is required',
  });
export type SessionParams = z.infer<typeof SessionParamsSchema>;
export type SessionListQuery = z.infer<typeof SessionListQuerySchema>;
export type SessionCreateRequest = z.infer<typeof SessionCreateSchema>;
export type SessionUpdateRequest = z.infer<typeof SessionUpdateSchema>;
export type SessionCreateInput = z.input<typeof SessionCreateSchema>;
export type SessionUpdateInput = z.input<typeof SessionUpdateSchema>;

// App specification and backlog plan
const generationOptions = {
  generateFeatures: z.boolean().optional().default(false),
  analyzeProject: z.boolean().optional().default(true),
  maxFeatures: z.number().int().min(1).max(1_000).optional(),
};
export const AppSpecCreateSchema = z
  .object({
    projectPath: ProjectPathSchema,
    projectOverview: z.string().trim().min(1).max(2_000_000),
    ...generationOptions,
  })
  .strict();
export const AppSpecGenerateSchema = z
  .object({
    projectPath: ProjectPathSchema,
    projectDefinition: z.string().trim().min(1).max(2_000_000),
    ...generationOptions,
  })
  .strict();
export const AppSpecProjectSchema = z.object({ projectPath: ProjectPathSchema }).strict();
export const AppSpecFeaturesSchema = z
  .object({
    projectPath: ProjectPathSchema,
    maxFeatures: z.number().int().min(1).max(1_000).optional(),
  })
  .strict();
export const AppSpecStopSchema = z.object({ projectPath: ProjectPathSchema.optional() }).strict();
export const AppSpecStatusSchema = z.object({ projectPath: ProjectPathSchema.optional() }).strict();
export type AppSpecCreateRequest = z.infer<typeof AppSpecCreateSchema>;
export type AppSpecGenerateRequest = z.infer<typeof AppSpecGenerateSchema>;
export type AppSpecProjectRequest = z.infer<typeof AppSpecProjectSchema>;
export type AppSpecFeaturesRequest = z.infer<typeof AppSpecFeaturesSchema>;
export type AppSpecStopRequest = z.infer<typeof AppSpecStopSchema>;
export type AppSpecStatusRequest = z.infer<typeof AppSpecStatusSchema>;

const BacklogChangeSchema = z
  .object({
    type: z.enum(['add', 'update', 'delete']),
    featureId: ProjectFeatureIdSchema.optional(),
    feature: FeatureDataSchema.optional(),
    reason: z.string().max(100_000).default(''),
  })
  .strict();
const DependencyUpdateSchema = z
  .object({
    featureId: ProjectFeatureIdSchema,
    removedDependencies: z.array(ProjectFeatureIdSchema).max(10_000),
    addedDependencies: z.array(ProjectFeatureIdSchema).max(10_000),
  })
  .strict();
export const BacklogPlanSchema = z
  .object({
    changes: z.array(BacklogChangeSchema).max(10_000),
    summary: z.string().max(1_000_000).default(''),
    dependencyUpdates: z.array(DependencyUpdateSchema).max(10_000).default([]),
  })
  .strict();
export const BacklogGenerateSchema = z
  .object({
    projectPath: ProjectPathSchema,
    prompt: z.string().trim().min(1).max(2_000_000),
    model: z.string().trim().min(1).max(255).optional(),
    branchName: z.string().trim().min(1).max(255).optional(),
    providerId: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
export const BacklogProjectSchema = z.object({ projectPath: ProjectPathSchema }).strict();
export const BacklogApplySchema = z
  .object({
    projectPath: ProjectPathSchema,
    plan: BacklogPlanSchema,
    branchName: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
export type BacklogPlan = z.infer<typeof BacklogPlanSchema>;
export type BacklogGenerateRequest = z.infer<typeof BacklogGenerateSchema>;
export type BacklogProjectRequest = z.infer<typeof BacklogProjectSchema>;
export type BacklogApplyRequest = z.infer<typeof BacklogApplySchema>;
export type BacklogGenerateInput = z.input<typeof BacklogGenerateSchema>;
export type BacklogApplyInput = z.input<typeof BacklogApplySchema>;
