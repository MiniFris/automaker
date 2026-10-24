import { z } from 'zod';

export const IdeaCategorySchema = z.enum([
  'feature',
  'ux-ui',
  'dx',
  'growth',
  'technical',
  'security',
  'performance',
  'accessibility',
  'analytics',
]);

const ProjectSchema = z.object({ projectPath: z.string().min(1) }).strict();
const IdeaIdSchema = ProjectSchema.extend({ ideaId: z.string().min(1) }).strict();
const level = z.enum(['low', 'medium', 'high']);

export const SessionStartSchema = ProjectSchema.extend({
  options: z
    .object({
      promptId: z.string().optional(),
      promptCategory: IdeaCategorySchema.optional(),
      initialMessage: z.string().optional(),
    })
    .strict()
    .optional(),
}).strict();
export const SessionMessageSchema = z
  .object({
    sessionId: z.string().min(1),
    message: z.string().min(1),
    options: z
      .object({
        imagePaths: z.array(z.string()).optional(),
        model: z.string().optional(),
        providerId: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const SessionStopSchema = z
  .object({ sessionId: z.string().min(1), projectPath: z.string().optional() })
  .strict();
export const SessionGetSchema = ProjectSchema.extend({ sessionId: z.string().min(1) }).strict();
export const ProjectRequestSchema = ProjectSchema;
export const IdeaGetSchema = IdeaIdSchema;
export const IdeaCreateSchema = ProjectSchema.extend({
  idea: z
    .object({
      title: z.string().min(1),
      description: z.string().min(1),
      category: IdeaCategorySchema,
      status: z.enum(['raw', 'refined', 'ready', 'archived']).optional(),
      impact: level.optional(),
      effort: level.optional(),
      conversationId: z.string().optional(),
      sourcePromptId: z.string().optional(),
      userStories: z.array(z.string()).optional(),
      notes: z.string().optional(),
    })
    .strict(),
}).strict();
export const IdeaUpdateSchema = IdeaIdSchema.extend({
  updates: z
    .object({
      title: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
      category: IdeaCategorySchema.optional(),
      status: z.enum(['raw', 'refined', 'ready', 'archived']).optional(),
      impact: level.optional(),
      effort: level.optional(),
      userStories: z.array(z.string()).optional(),
      notes: z.string().optional(),
    })
    .strict(),
}).strict();
export const ConvertSchema = IdeaIdSchema.extend({
  keepIdea: z.boolean().optional(),
  column: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
}).strict();
export const SuggestionSchema = z
  .object({
    id: z.string().optional(),
    category: IdeaCategorySchema,
    title: z.string().min(1),
    description: z.string(),
    rationale: z.string().optional(),
    relatedFiles: z.array(z.string()).optional(),
    priority: level.optional(),
  })
  .strict();
export const AddSuggestionSchema = ProjectSchema.extend({ suggestion: SuggestionSchema }).strict();
export const GenerateSuggestionsSchema = ProjectSchema.extend({
  promptId: z.string().min(1),
  category: IdeaCategorySchema,
  count: z.number().int().optional(),
  contextSources: z
    .object({
      useContextFiles: z.boolean(),
      useMemoryFiles: z.boolean(),
      useExistingFeatures: z.boolean(),
      useExistingIdeas: z.boolean(),
      useAppSpec: z.boolean(),
    })
    .strict()
    .optional(),
}).strict();

export type SessionStartRequest = z.infer<typeof SessionStartSchema>;
export type SessionMessageRequest = z.infer<typeof SessionMessageSchema>;
export type SessionStopRequest = z.infer<typeof SessionStopSchema>;
export type SessionGetRequest = z.infer<typeof SessionGetSchema>;
export type ProjectRequest = z.infer<typeof ProjectRequestSchema>;
export type IdeaGetRequest = z.infer<typeof IdeaGetSchema>;
export type IdeaCreateRequest = z.infer<typeof IdeaCreateSchema>;
export type IdeaUpdateRequest = z.infer<typeof IdeaUpdateSchema>;
export type ConvertRequest = z.infer<typeof ConvertSchema>;
export type AddSuggestionRequest = z.infer<typeof AddSuggestionSchema>;
export type GenerateSuggestionsRequest = z.infer<typeof GenerateSuggestionsSchema>;
