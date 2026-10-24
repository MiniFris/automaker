import { z } from 'zod';

const text = z.string();
const strings = z.array(text);
const count = z.number().int().nonnegative();
const workspace = z
  .object({ version: z.literal(1), branch: text, baseBranch: text, baseCommit: text })
  .passthrough();
const selection = z.union([
  z.object({ mode: z.enum(['local', 'auto']) }).passthrough(),
  z.object({ mode: z.literal('profile'), profileId: text }).passthrough(),
]);
export const SessionExecutionBindingSchema = z
  .object({
    version: z.literal(1),
    id: text,
    type: z.enum(['legacy', 'local', 'docker', 'ssh']),
    projectPath: text,
    cwd: text,
    createdAt: text,
    serverIdentity: text,
    selection,
    source: z.enum(['global', 'project']),
    runtimeCwd: text.optional(),
    docker: z
      .object({
        owner: text,
        engineId: text,
        context: text.optional(),
        containerId: text,
        imageId: text,
        projectPath: text,
        user: text,
        mount: z
          .object({ type: z.enum(['bind', 'volume']), source: text, subpath: text.optional() })
          .passthrough(),
      })
      .passthrough()
      .optional(),
    ssh: z
      .object({
        version: z.literal(1),
        ready: z.boolean(),
        preparationPath: text.optional(),
        owner: text,
        profile: z
          .object({
            id: text,
            name: text,
            type: z.literal('ssh'),
            host: text,
            port: z.number().int(),
            username: text,
            basePath: text,
            credentialId: text.optional(),
          })
          .passthrough(),
        fingerprint: text,
        identity: text,
        projectPath: text,
        remotePath: text,
        workerPath: text,
        workerHash: text,
        cancelPath: text,
        cancelHash: text,
        jobsDirectory: text,
      })
      .passthrough()
      .optional(),
    sshWorkspace: workspace.optional(),
    featureWorkspace: workspace.optional(),
    featurePreparation: z
      .object({ targetBranch: text.nullable().optional() })
      .passthrough()
      .optional(),
    fallbackReason: z.literal('docker-preflight-unavailable').optional(),
  })
  .passthrough();

// Older metadata may omit fields added by later clients. Do not fabricate them on reads.
export const SessionMetadataResponseSchema = z
  .object({
    id: text,
    name: text.optional(),
    projectPath: text.optional(),
    workingDirectory: text.optional(),
    createdAt: text.optional(),
    updatedAt: text.optional(),
    archived: z.boolean().optional(),
    tags: strings.optional(),
    model: text.optional(),
    providerId: text.optional(),
    sdkSessionId: text.optional(),
    executionEnvironment: SessionExecutionBindingSchema.optional(),
  })
  .passthrough();
export const SessionMessageResponseSchema = z
  .object({
    id: text,
    role: z.enum(['user', 'assistant']),
    content: text,
    timestamp: text,
    images: z
      .array(z.object({ data: text, mimeType: text, filename: text }).passthrough())
      .optional(),
    isError: z.boolean().optional(),
    deliveryId: text.optional(),
    queuedPromptId: text.optional(),
    deliveryStatus: z.enum(['completed', 'failed', 'cancelled', 'interrupted']).optional(),
    runId: text.optional(),
    executionStatus: z.enum(['completed', 'failed', 'cancelled', 'interrupted']).optional(),
  })
  .passthrough();
export const SessionListItemResponseSchema = z
  .object({
    id: text,
    name: text.optional(),
    projectPath: text.optional(),
    workingDirectory: text.optional(),
    model: text.optional(),
    providerId: text.optional(),
    executionEnvironment: SessionExecutionBindingSchema.optional(),
    createdAt: text.optional(),
    updatedAt: text.optional(),
    isArchived: z.boolean(),
    tags: strings,
    messageCount: count,
    preview: text,
  })
  .passthrough();
export const SessionListResponseSchema = z
  .object({ success: z.literal(true), sessions: z.array(SessionListItemResponseSchema) })
  .passthrough();
export const SessionMetadataEnvelopeSchema = z
  .object({ success: z.literal(true), session: SessionMetadataResponseSchema })
  .passthrough();
export const SessionReadResponseSchema = SessionMetadataEnvelopeSchema.extend({
  messages: z.array(SessionMessageResponseSchema),
});
export const SessionCreateResponseSchema = z
  .object({
    success: z.literal(true),
    session: SessionMetadataResponseSchema.extend({
      name: text,
      workingDirectory: text,
      createdAt: text,
      updatedAt: text,
    }),
  })
  .passthrough();
export const SessionMutationResponseSchema = z.object({ success: z.literal(true) }).passthrough();
