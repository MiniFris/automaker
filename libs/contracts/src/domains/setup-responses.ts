import { z } from 'zod';
import { CursorPermissionsTargetSchema } from '../cursor-permissions.js';
export {
  ProviderConnectionTargetResponseSchema,
  ProviderDisconnectResponseSchema,
  ProviderReconnectResponseSchema,
} from '../provider-connection.js';
export { ProviderInstallGuidanceSchema } from '../provider-install-guidance.js';
export {
  SetupCredentialTargetResponseSchema,
  SetupCredentialMutationResponseSchema,
} from '../setup-credentials.js';
export {
  ClaudeVerificationTargetResponseSchema,
  ClaudeVerificationResponseSchema,
} from '../claude-verification.js';
export {
  CodexVerificationTargetResponseSchema,
  CodexVerificationResponseSchema,
} from '../codex-verification.js';
export {
  GithubAuthenticationTargetResponseSchema,
  GithubAuthenticationResponseSchema,
} from '../github-authentication.js';
export { CursorSetupStatusSchema } from '../cursor-status.js';
export { GeminiSetupStatusSchema } from '../gemini-status.js';
export { CopilotSetupStatusSchema } from '../copilot-status.js';
export {
  CursorModelConfigTargetResponseSchema,
  CursorModelConfigResponseSchema,
  CursorDefaultModelResponseSchema,
  CursorEnabledModelsResponseSchema,
} from '../cursor-model-config.js';
export {
  CursorPermissionsTargetResponseSchema,
  CursorPermissionsMutationResponseSchema,
} from '../cursor-permissions.js';

const text = z.string();
const flag = z.boolean();
const optionalText = text.nullish();
export const SetupClaudeStatusResponseSchema = z
  .object({
    success: z.literal(true),
    status: text,
    installed: flag,
    method: text,
    version: text,
    path: text,
    auth: z
      .object({
        authenticated: flag,
        authenticationChecked: flag,
        method: text,
        hasCredentialsFile: flag,
        hasToken: flag,
        hasStoredOAuthToken: flag,
        hasStoredApiKey: flag,
        hasEnvApiKey: flag,
        oauthTokenValid: flag,
        apiKeyValid: flag,
        hasCliAuth: flag,
        hasRecentActivity: flag,
      })
      .passthrough(),
  })
  .passthrough();
export const SetupGithubStatusResponseSchema = z
  .object({
    success: z.literal(true),
    installed: flag,
    authenticationChecked: flag,
    authenticated: flag,
    user: text.nullable(),
    version: text.nullable(),
    path: text.nullable(),
  })
  .passthrough();
export const SetupInstallationStatusResponseSchema = z
  .object({
    success: z.literal(true),
    connected: flag,
    installed: flag,
    version: text.nullable(),
    path: text.nullable(),
    auth: z
      .object({
        authenticated: flag,
        authenticationChecked: flag,
        method: text,
        hasApiKey: flag,
        hasAuthFile: flag,
        hasEnvApiKey: flag.nullish(),
        hasOAuthToken: flag.nullish(),
      })
      .passthrough(),
    installCommand: text,
    loginCommand: text,
    installCommands: z.record(text, text).nullish(),
    recommendation: optionalText,
  })
  .passthrough();
export const SetupKeyPresenceResponseSchema = z
  .object({
    success: z.literal(true),
    hasAnthropicKey: flag,
    hasGoogleKey: flag,
    hasOpenaiKey: flag,
  })
  .passthrough();
export const SetupPlatformResponseSchema = z
  .object({
    success: z.literal(true),
    platform: text,
    arch: text,
    homeDir: text,
    isWindows: flag,
    isMac: flag,
    isLinux: flag,
  })
  .passthrough();
export const SetupModelRecordSchema = z
  .object({
    id: text,
    name: text,
    modelString: text,
    provider: text,
    description: text,
    providerId: optionalText,
    contextWindow: z.number().nullish(),
    maxOutputTokens: z.number().nullish(),
    supportsVision: flag.nullish(),
    supportsTools: flag.nullish(),
    tier: optionalText,
    default: flag.nullish(),
    hasReasoning: flag.nullish(),
  })
  .passthrough();
export const SetupModelsResponseSchema = z
  .object({
    success: z.literal(true),
    models: z.array(SetupModelRecordSchema),
    count: z.number().int().nonnegative(),
    cached: flag,
  })
  .passthrough();
export const SetupAuthenticatedProviderRecordSchema = z
  .object({ id: text, name: text, authenticated: flag, authMethod: optionalText })
  .passthrough();
export const SetupAuthenticatedProvidersResponseSchema = z
  .object({
    success: z.literal(true),
    providers: z.array(SetupAuthenticatedProviderRecordSchema),
    authenticated: z.array(SetupAuthenticatedProviderRecordSchema),
  })
  .passthrough();
export const SetupCacheClearResponseSchema = z
  .object({ success: z.literal(true), message: text })
  .passthrough();
const permissionProfile = z
  .object({
    id: text,
    name: text,
    description: text,
    permissions: z.object({ allow: z.array(text), deny: z.array(text) }).passthrough(),
  })
  .passthrough();
// read() casts persisted permissions; do not apply the strict mutation schema to those values.
export const SetupCursorPermissionsReadResponseSchema = z
  .object({
    success: z.literal(true),
    globalPermissions: z.unknown(),
    projectPermissions: z.unknown(),
    effectivePermissions: z.unknown(),
    activeProfile: text.nullable(),
    hasProjectConfig: flag,
    availableProfiles: z.array(permissionProfile),
    globalTarget: CursorPermissionsTargetSchema,
    projectTarget: CursorPermissionsTargetSchema.optional(),
  })
  .passthrough();
export const SetupCursorPermissionsExampleResponseSchema = z
  .object({ success: z.literal(true), profileId: text, config: text })
  .passthrough();
export type SetupModelsResponse = z.infer<typeof SetupModelsResponseSchema>;
export type SetupCursorPermissionsReadResponse = z.infer<
  typeof SetupCursorPermissionsReadResponseSchema
>;
