import { z } from 'zod';

/** Stored ideas/messages/analysis are extensible JSON records, not request enums. */
export const PublicIdeaDataSchema = z.record(z.string(), z.unknown());
export const PublicIdeationMessageSchema = z.record(z.string(), z.unknown());
export const IdeationSuccessResponseSchema = z.object({ success: z.literal(true) }).passthrough();
export const IdeationSessionStartResponseSchema = z
  .object({
    success: z.literal(true),
    session: z
      .object({
        id: z.string(),
        projectPath: z.string(),
        status: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        promptId: z.string().optional(),
        promptCategory: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export const IdeationSessionReadResponseSchema = z
  .object({
    success: z.literal(true),
    session: z
      .object({ isRunning: z.boolean(), messages: z.array(PublicIdeationMessageSchema) })
      .passthrough(),
    messages: z.array(PublicIdeationMessageSchema),
  })
  .passthrough();
export const IdeationIdeaListResponseSchema = z
  .object({ success: z.literal(true), ideas: z.array(PublicIdeaDataSchema) })
  .passthrough();
export const IdeationIdeaResponseSchema = z
  .object({ success: z.literal(true), idea: PublicIdeaDataSchema })
  .passthrough();
export const IdeationAnalysisAcceptedResponseSchema = z
  .object({ success: z.literal(true), message: z.string() })
  .passthrough();
export const IdeationAnalysisResponseSchema = z
  .object({ success: z.literal(true), result: z.record(z.string(), z.unknown()).nullable() })
  .passthrough();
export const IdeationFeatureResponseSchema = z
  .object({ success: z.literal(true), featureId: z.string() })
  .passthrough();
export const PublicIdeationPromptSchema = z
  .object({
    id: z.string(),
    category: z.string(),
    title: z.string(),
    description: z.string(),
    prompt: z.string(),
    icon: z.string().optional(),
  })
  .passthrough();
export const PublicIdeationCategorySchema = z
  .object({ id: z.string(), name: z.string(), icon: z.string(), description: z.string() })
  .passthrough();
export const IdeationPromptsResponseSchema = z
  .object({
    success: z.literal(true),
    prompts: z.array(PublicIdeationPromptSchema),
    categories: z.array(PublicIdeationCategorySchema),
  })
  .passthrough();
export const IdeationCategoryPromptsResponseSchema = z
  .object({ success: z.literal(true), prompts: z.array(PublicIdeationPromptSchema) })
  .passthrough();
// Provider text parsing owns the id/category; legacy/raw suggestion labels are preserved.
export const PublicIdeationSuggestionSchema = z
  .object({ id: z.string(), category: z.string() })
  .passthrough();
export const IdeationSuggestionsResponseSchema = z
  .object({ success: z.literal(true), suggestions: z.array(PublicIdeationSuggestionSchema) })
  .passthrough();

export type PublicIdeaData = z.infer<typeof PublicIdeaDataSchema>;
export type IdeationSessionStartResponse = z.infer<typeof IdeationSessionStartResponseSchema>;
export type IdeationSessionReadResponse = z.infer<typeof IdeationSessionReadResponseSchema>;
export type IdeationIdeaListResponse = z.infer<typeof IdeationIdeaListResponseSchema>;
export type IdeationIdeaResponse = z.infer<typeof IdeationIdeaResponseSchema>;
export type IdeationAnalysisResponse = z.infer<typeof IdeationAnalysisResponseSchema>;
export type IdeationPromptsResponse = z.infer<typeof IdeationPromptsResponseSchema>;
export type IdeationSuggestionsResponse = z.infer<typeof IdeationSuggestionsResponseSchema>;
