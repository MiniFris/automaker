/** User-configurable deadlines for model work, in milliseconds. Omitted values retain legacy defaults. */
export interface ModelTimeoutSettings {
  requestTimeoutMs?: number;
  responseHeadersTimeoutMs?: number;
  modelDiscoveryTimeoutMs?: number;
  connectionTestTimeoutMs?: number;
  agentTimeoutMs?: number;
  toolTimeoutMs?: number;
  checkpointTimeoutMs?: number;
  cliIdleTimeoutMs?: number;
  codexExtendedIdleTimeoutMs?: number;
  remoteProcessTimeoutMs?: number;
  verificationTimeoutMs?: number;
  pipelineTestTimeoutMs?: number;
  commitMessageTimeoutMs?: number;
  prDescriptionTimeoutMs?: number;
  retryAfterMaxMs?: number;
  retryBackoffMaxMs?: number;
}

/** Node timers cannot represent longer deadlines without overflowing. */
export const MAX_MODEL_TIMEOUT_MS = 2_147_483_647;
export const DEFAULT_MODEL_TIMEOUTS = {
  requestTimeoutMs: 120_000,
  responseHeadersTimeoutMs: 30_000,
  modelDiscoveryTimeoutMs: 30_000,
  connectionTestTimeoutMs: 30_000,
  agentTimeoutMs: 300_000,
  toolTimeoutMs: 10_000,
  checkpointTimeoutMs: 1_000,
  cliIdleTimeoutMs: 120_000,
  codexExtendedIdleTimeoutMs: 300_000,
  remoteProcessTimeoutMs: 600_000,
  verificationTimeoutMs: 120_000,
  pipelineTestTimeoutMs: 600_000,
  commitMessageTimeoutMs: 30_000,
  prDescriptionTimeoutMs: 30_000,
  retryAfterMaxMs: 5_000,
  retryBackoffMaxMs: 2_000,
} as const satisfies Required<ModelTimeoutSettings>;

/** Endpoint request timeout keeps its existing timeoutMs field; other overrides live in timeouts. */
export const DIRECT_TIMEOUT_KEYS = [
  'responseHeadersTimeoutMs',
  'modelDiscoveryTimeoutMs',
  'connectionTestTimeoutMs',
  'agentTimeoutMs',
  'toolTimeoutMs',
  'checkpointTimeoutMs',
  'retryAfterMaxMs',
  'retryBackoffMaxMs',
] as const satisfies readonly (keyof ModelTimeoutSettings)[];
export type DirectTimeoutSettings = Pick<
  ModelTimeoutSettings,
  (typeof DIRECT_TIMEOUT_KEYS)[number]
>;

/** Validate both API writes and persisted settings; errors never include submitted values. */
export function parseModelTimeoutSettings(
  value: unknown,
  allowed: readonly (keyof ModelTimeoutSettings)[] = Object.keys(DEFAULT_MODEL_TIMEOUTS) as Array<
    keyof ModelTimeoutSettings
  >
): ModelTimeoutSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid model timeout settings.');
  const result: ModelTimeoutSettings = {};
  for (const [key, duration] of Object.entries(value)) {
    if (!allowed.includes(key as keyof ModelTimeoutSettings))
      throw new Error('Unknown model timeout setting.');
    if (
      !Number.isSafeInteger(duration) ||
      typeof duration !== 'number' ||
      duration < 1 ||
      duration > MAX_MODEL_TIMEOUT_MS
    )
      throw new Error(`Invalid model timeout: ${key}. Use positive integer milliseconds.`);
    result[key as keyof ModelTimeoutSettings] = duration;
  }
  return result;
}

export function modelTimeout(
  settings: ModelTimeoutSettings | undefined,
  key: keyof ModelTimeoutSettings
): number {
  const value = settings?.[key] ?? DEFAULT_MODEL_TIMEOUTS[key];
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_MODEL_TIMEOUT_MS)
    throw new Error(`Invalid model timeout: ${key}.`);
  return value;
}

export const MODEL_TIMEOUT_PROVIDERS = [
  'openai-compatible',
  'claude',
  'codex',
  'cursor',
  'opencode',
  'gemini',
  'copilot',
] as const;
export type ModelTimeoutProvider = (typeof MODEL_TIMEOUT_PROVIDERS)[number];
export type ProviderModelTimeoutSettings = Partial<
  Record<ModelTimeoutProvider, ModelTimeoutSettings>
>;
export const WORKFLOW_TIMEOUT_KEYS = [
  'verificationTimeoutMs',
  'pipelineTestTimeoutMs',
  'commitMessageTimeoutMs',
  'prDescriptionTimeoutMs',
] as const;
const cliKeys = ['cliIdleTimeoutMs', 'remoteProcessTimeoutMs', ...WORKFLOW_TIMEOUT_KEYS] as const;
export const PROVIDER_TIMEOUT_KEYS: Record<
  ModelTimeoutProvider,
  readonly (keyof ModelTimeoutSettings)[]
> = {
  'openai-compatible': ['requestTimeoutMs', ...DIRECT_TIMEOUT_KEYS, ...WORKFLOW_TIMEOUT_KEYS],
  claude: ['requestTimeoutMs', 'connectionTestTimeoutMs', ...cliKeys],
  codex: ['connectionTestTimeoutMs', 'codexExtendedIdleTimeoutMs', ...cliKeys],
  cursor: cliKeys,
  opencode: cliKeys,
  gemini: cliKeys,
  copilot: cliKeys,
};

export function parseProviderModelTimeoutSettings(value: unknown): ProviderModelTimeoutSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid provider timeout settings.');
  const result: ProviderModelTimeoutSettings = {};
  for (const [provider, timeouts] of Object.entries(value)) {
    if (!MODEL_TIMEOUT_PROVIDERS.includes(provider as ModelTimeoutProvider))
      throw new Error('Unknown timeout provider.');
    result[provider as ModelTimeoutProvider] = parseModelTimeoutSettings(
      timeouts,
      PROVIDER_TIMEOUT_KEYS[provider as ModelTimeoutProvider]
    );
  }
  return result;
}

/** An explicit provider record (even {}) masks legacy shared values. No global UI control remains. */
export function providerModelTimeouts(
  settings:
    | { modelTimeouts?: ModelTimeoutSettings; providerModelTimeouts?: ProviderModelTimeoutSettings }
    | null
    | undefined,
  provider: ModelTimeoutProvider
): ModelTimeoutSettings {
  const stored = settings?.providerModelTimeouts;
  if (stored && Object.prototype.hasOwnProperty.call(stored, provider))
    return parseModelTimeoutSettings(stored[provider], PROVIDER_TIMEOUT_KEYS[provider]);
  const legacy = parseModelTimeoutSettings(settings?.modelTimeouts ?? {});
  return Object.fromEntries(
    Object.entries(legacy).filter(([key]) =>
      PROVIDER_TIMEOUT_KEYS[provider].includes(key as keyof ModelTimeoutSettings)
    )
  );
}
