import { z } from 'zod';

const text = z.string();
const optionalText = text.nullish();
const count = z.number().int().nonnegative();
export const EnvironmentSelectionRecordSchema = z
  .object({ mode: text, profileId: optionalText })
  .passthrough();
export const EnvironmentProfileRecordSchema = z
  .object({
    id: text,
    name: text,
    type: text,
    context: optionalText,
    host: optionalText,
    port: z.number().nullish(),
    username: optionalText,
    basePath: optionalText,
    credentialId: optionalText,
  })
  .passthrough();
export const EnvironmentSettingsRecordSchema = z
  .object({
    default: EnvironmentSelectionRecordSchema,
    profiles: z.array(EnvironmentProfileRecordSchema),
  })
  .passthrough();
export const SSHHostKeyRecordSchema = z
  .object({ algorithm: text, fingerprint: text })
  .passthrough();
export const SSHEnvironmentStatusRecordSchema = z
  .object({
    trustedHost: SSHHostKeyRecordSchema.nullish(),
    hasPrivateKey: z.boolean(),
    agentAvailable: z.boolean(),
    project: z
      .object({
        remotePath: text,
        pendingOperations: count,
        preparing: z.boolean().nullish(),
        stagingPath: optionalText,
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();
export const EnvironmentConsentRecordSchema = z
  .object({
    warningVersion: z.number(),
    confirmed: z.boolean(),
    scope: text.nullable(),
    legacy: z.boolean(),
    serverContainerized: z.boolean(),
    autoFallbackConfirmed: z.boolean().nullish(),
    autoFallbackScope: optionalText,
  })
  .passthrough();
export const EnvironmentResolvedRecordSchema = z
  .object({
    selection: EnvironmentSelectionRecordSchema,
    source: text,
    type: text,
    profile: EnvironmentProfileRecordSchema.nullish(),
    runtimeIntegrated: z.boolean(),
  })
  .passthrough();
export const ExecutionEnvironmentSettingsResponseSchema = z
  .object({
    success: z.literal(true),
    settings: EnvironmentSettingsRecordSchema,
    projectOverride: EnvironmentSelectionRecordSchema.nullable(),
    resolved: EnvironmentResolvedRecordSchema,
    localConsent: EnvironmentConsentRecordSchema.nullish(),
    ssh: SSHEnvironmentStatusRecordSchema.nullish(),
  })
  .passthrough();

// peek() validates only these three fields; all other historical binding data is opaque.
export const EnvironmentBindingRecordSchema = z
  .object({
    version: z.number(),
    id: text,
    projectPath: text,
  })
  .passthrough();
export const ExecutionEnvironmentFeatureResponseSchema = z
  .object({
    success: z.literal(true),
    binding: EnvironmentBindingRecordSchema.nullable(),
    selectedType: text,
  })
  .passthrough();
export const DockerDiagnosticRecordSchema = z
  .object({
    status: text,
    checkedAt: text,
    scope: text,
    containerLifecycle: text,
    projectStorage: text,
    platform: text,
    serverContainerized: z.boolean(),
    message: text,
    remediation: z.array(text),
    documentation: z.array(z.object({ label: text, url: text }).passthrough()),
  })
  .passthrough();
export const ExecutionDockerDiagnosticResponseSchema = z
  .object({ success: z.literal(true), diagnostic: DockerDiagnosticRecordSchema })
  .passthrough();
export const DockerPreparationRecordSchema = z
  .object({
    connection: text,
    containerLifecycle: text,
    projectStorage: text,
    checkedAt: text,
    message: text,
    containerId: optionalText,
  })
  .passthrough();
export const ExecutionDockerPreparationResponseSchema = z
  .object({ success: z.literal(true), preparation: DockerPreparationRecordSchema })
  .passthrough();
export const RemoteProviderStatusRecordSchema = z
  .object({
    provider: text,
    targetId: text,
    environment: text,
    cwd: text,
    packageVersion: text,
    installed: z.boolean(),
    root: text,
    hasStoredKey: z.boolean(),
    credentialSource: text,
    authentication: text,
  })
  .passthrough();
export const ExecutionProviderStatusResponseSchema = z
  .object({ success: z.literal(true), status: RemoteProviderStatusRecordSchema })
  .passthrough();
export const ExecutionSSHScanResponseSchema = z
  .object({ success: z.literal(true), hostKey: SSHHostKeyRecordSchema })
  .passthrough();
export const SSHDiagnosticRecordSchema = z
  .object({
    status: text,
    checkedAt: text,
    message: text,
    hostKey: SSHHostKeyRecordSchema.nullish(),
    worker: text,
    project: text,
    remotePath: optionalText,
  })
  .passthrough();
export const ExecutionSSHDiagnosticResponseSchema = z
  .object({ success: z.literal(true), diagnostic: SSHDiagnosticRecordSchema })
  .passthrough();
export type ExecutionEnvironmentSettingsResponse = z.infer<
  typeof ExecutionEnvironmentSettingsResponseSchema
>;
export type ExecutionEnvironmentFeatureResponse = z.infer<
  typeof ExecutionEnvironmentFeatureResponseSchema
>;
export type ExecutionDockerDiagnosticResponse = z.infer<
  typeof ExecutionDockerDiagnosticResponseSchema
>;
export type ExecutionDockerPreparationResponse = z.infer<
  typeof ExecutionDockerPreparationResponseSchema
>;
export type ExecutionProviderStatusResponse = z.infer<typeof ExecutionProviderStatusResponseSchema>;
export type ExecutionSSHScanResponse = z.infer<typeof ExecutionSSHScanResponseSchema>;
export type ExecutionSSHDiagnosticResponse = z.infer<typeof ExecutionSSHDiagnosticResponseSchema>;
