import { z } from 'zod';
import { MODEL_TIMEOUT_PROVIDERS } from '@automaker/types';

// One provider catalog governs settings validation on server and clients.
export const ModelTimeoutProviderSchema = z.enum(MODEL_TIMEOUT_PROVIDERS);

// Settings documents are extensible user-owned maps. Validate their container, not user fields.
export const SettingsDocumentRecordSchema = z.record(z.string(), z.unknown());
export const SettingsStatusResponseSchema = z
  .object({
    success: z.literal(true),
    hasGlobalSettings: z.boolean(),
    hasCredentials: z.boolean(),
    dataDir: z.string(),
    needsMigration: z.boolean(),
  })
  .passthrough();
export const SettingsDocumentResponseSchema = z
  .object({ success: z.literal(true), settings: SettingsDocumentRecordSchema })
  .passthrough();
const maskedCredential = z.object({ configured: z.boolean(), masked: z.string() }).passthrough();
export const SettingsCredentialsResponseSchema = z
  .object({
    success: z.literal(true),
    credentials: z
      .object({
        anthropic: maskedCredential,
        google: maskedCredential,
        openai: maskedCredential,
        zai: maskedCredential,
      })
      .passthrough(),
  })
  .passthrough();
export const SettingsAgentRecordSchema = z
  .object({
    name: z.string(),
    source: z.string(),
    filePath: z.string(),
    definition: z
      .object({
        description: z.string(),
        prompt: z.string(),
        tools: z.array(z.string()).nullish(),
        model: z.string().nullish(),
      })
      .passthrough(),
  })
  .passthrough();
export const SettingsAgentsResponseSchema = z
  .object({ success: z.literal(true), agents: z.array(SettingsAgentRecordSchema) })
  .passthrough();
export const SettingsTimeoutRecordSchema = z.record(z.string(), z.number());
export const SettingsTimeoutsResponseSchema = z
  .object({ success: z.literal(true), timeouts: SettingsTimeoutRecordSchema })
  .passthrough();
export const SettingsDirectModelRecordSchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
    capabilities: z
      .object({
        tools: z.boolean(),
        streaming: z.boolean(),
        vision: z.boolean().nullish(),
        structuredOutput: z.boolean().nullish(),
        reasoning: z.boolean().nullish(),
      })
      .passthrough(),
    contextWindow: z.number().nullish(),
    maxOutputTokens: z.number().nullish(),
  })
  .passthrough();
export const SettingsDirectEndpointRecordSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    baseUrl: z.string(),
    protocol: z.string(),
    auth: z
      .object({
        type: z.string(),
        variableName: z.string().nullish(),
        credentialId: z.string().nullish(),
      })
      .passthrough(),
    timeoutMs: z.number().nullish(),
    timeouts: SettingsTimeoutRecordSchema.nullish(),
    maxRetries: z.number().nullish(),
    models: z.array(SettingsDirectModelRecordSchema),
  })
  .passthrough();
export const SettingsDirectAgentRecordSchema = z
  .object({
    access: z.string().nullish(),
    shell: z
      .object({ backend: z.string(), image: z.string(), executable: z.string().nullish() })
      .passthrough()
      .nullish(),
    limits: z.record(z.string(), z.number()).nullish(),
  })
  .passthrough();
export const SettingsDirectResponseSchema = z
  .object({
    success: z.literal(true),
    endpoints: z.array(
      z
        .object({ endpoint: SettingsDirectEndpointRecordSchema, keyConfigured: z.boolean() })
        .passthrough()
    ),
    agentSettings: SettingsDirectAgentRecordSchema,
  })
  .passthrough();
export const SettingsMigrationResponseSchema = z
  .object({
    success: z.boolean(),
    migratedGlobalSettings: z.boolean(),
    migratedCredentials: z.boolean(),
    credentialImportRequired: z.boolean(),
    migratedProjectCount: z.number().int().nonnegative(),
    errors: z.array(z.string()),
  })
  .passthrough();
export const SettingsDirectModelsResponseSchema = z
  .object({ success: z.literal(true), models: z.array(z.string()) })
  .passthrough();
export const SettingsDirectTestResponseSchema = z
  .object({ success: z.literal(true), verified: z.boolean(), tools: z.boolean() })
  .passthrough();
export const SettingsRetiredCredentialsResponseSchema = z
  .object({ success: z.literal(false), errorCode: z.string(), error: z.string() })
  .passthrough();
export type SettingsStatusResponse = z.infer<typeof SettingsStatusResponseSchema>;
export type SettingsDocumentResponse = z.infer<typeof SettingsDocumentResponseSchema>;
export type SettingsCredentialsResponse = z.infer<typeof SettingsCredentialsResponseSchema>;
export type SettingsAgentsResponse = z.infer<typeof SettingsAgentsResponseSchema>;
export type SettingsTimeoutsResponse = z.infer<typeof SettingsTimeoutsResponseSchema>;
export type SettingsDirectResponse = z.infer<typeof SettingsDirectResponseSchema>;
export type SettingsMigrationResponse = z.infer<typeof SettingsMigrationResponseSchema>;
export type SettingsDirectModelsResponse = z.infer<typeof SettingsDirectModelsResponseSchema>;
export type SettingsDirectTestResponse = z.infer<typeof SettingsDirectTestResponseSchema>;
