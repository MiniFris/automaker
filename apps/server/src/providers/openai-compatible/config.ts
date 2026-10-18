import {
  isDirectModel,
  DIRECT_TIMEOUT_KEYS,
  DEFAULT_MODEL_TIMEOUTS,
  parseModelTimeoutSettings,
  stripProviderPrefix,
  type Credentials,
  type OpenAICompatibleAuth,
  type OpenAICompatibleCapabilities,
  type OpenAICompatibleEndpoint,
  type OpenAICompatibleModel,
  type ResolvedOpenAICompatibleConnection,
  type ModelTimeoutSettings,
} from '@automaker/types';

export const DEFAULT_DIRECT_TIMEOUT_MS = DEFAULT_MODEL_TIMEOUTS.requestTimeoutMs;
export const DEFAULT_DIRECT_MAX_RETRIES = 2;

/** Errors name configuration fields, never their values (which may contain secrets). */
function invalid(field: string): never {
  throw new Error(`Invalid OpenAI-compatible configuration: ${field}.`);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, allowed: string[], field: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid(field);
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) invalid(field);
  if (/[\x00-\x1f\x7f]/.test(value)) invalid(field);
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') invalid(field);
  return value;
}

function integer(value: unknown, field: string, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) invalid(field);
  return value;
}

/** Retains an API prefix such as /v1 or /api; callers append resource paths to this base. */
export function normalizeOpenAICompatibleBaseUrl(value: unknown): string {
  const baseUrl = text(value, 'baseUrl');
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return invalid('baseUrl');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    invalid('baseUrl');
  }
  // /v1 is supplied by the user, not guessed or appended automatically.
  return url.href.replace(/\/+$/, '') + '/';
}

function parseAuth(value: unknown): OpenAICompatibleAuth {
  const auth = object(value, 'auth');
  switch (auth.type) {
    case 'none':
      fields(auth, ['type'], 'auth');
      return { type: 'none' };
    case 'env': {
      fields(auth, ['type', 'variableName'], 'auth');
      const variableName = text(auth.variableName, 'auth.variableName');
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName)) invalid('auth.variableName');
      return { type: 'env', variableName };
    }
    case 'credentials':
      fields(auth, ['type', 'credentialId'], 'auth');
      return { type: 'credentials', credentialId: text(auth.credentialId, 'auth.credentialId') };
    default:
      return invalid('auth.type');
  }
}

function parseModel(value: unknown): OpenAICompatibleModel {
  const model = object(value, 'models[]');
  fields(
    model,
    ['id', 'displayName', 'capabilities', 'contextWindow', 'maxOutputTokens'],
    'models[]'
  );
  const raw = object(model.capabilities, 'models[].capabilities');
  fields(
    raw,
    ['tools', 'streaming', 'vision', 'structuredOutput', 'reasoning'],
    'models[].capabilities'
  );
  const capabilities: OpenAICompatibleCapabilities = {
    tools: boolean(raw.tools, 'models[].capabilities.tools'),
    streaming: boolean(raw.streaming, 'models[].capabilities.streaming'),
  };
  for (const key of ['vision', 'structuredOutput', 'reasoning'] as const) {
    if (raw[key] !== undefined)
      capabilities[key] = boolean(raw[key], `models[].capabilities.${key}`);
  }
  return {
    id: text(model.id, 'models[].id'),
    displayName: text(model.displayName, 'models[].displayName'),
    capabilities,
    ...(model.contextWindow !== undefined && {
      contextWindow: integer(model.contextWindow, 'models[].contextWindow'),
    }),
    ...(model.maxOutputTokens !== undefined && {
      maxOutputTokens: integer(model.maxOutputTokens, 'models[].maxOutputTokens'),
    }),
  };
}

/** Validate untrusted persisted/API input and return a detached, secret-free configuration. */
export function parseOpenAICompatibleEndpoint(value: unknown): OpenAICompatibleEndpoint {
  const endpoint = object(value, 'endpoint');
  fields(
    endpoint,
    [
      'id',
      'name',
      'enabled',
      'baseUrl',
      'protocol',
      'auth',
      'timeoutMs',
      'timeouts',
      'maxRetries',
      'models',
    ],
    'endpoint'
  );
  if (endpoint.protocol !== 'chat-completions' && endpoint.protocol !== 'responses')
    invalid('protocol');
  if (!Array.isArray(endpoint.models)) invalid('models');
  const models = endpoint.models.map(parseModel);
  if (new Set(models.map((model) => model.id)).size !== models.length)
    invalid('models (duplicate IDs)');
  const maxRetries =
    endpoint.maxRetries === undefined
      ? DEFAULT_DIRECT_MAX_RETRIES
      : integer(endpoint.maxRetries, 'maxRetries', 0);
  if (maxRetries > 5) invalid('maxRetries');
  const timeoutMs =
    endpoint.timeoutMs === undefined ? undefined : integer(endpoint.timeoutMs, 'timeoutMs');
  // Node timers overflow above this value and would fire almost immediately.
  if (timeoutMs !== undefined && timeoutMs > 2_147_483_647) invalid('timeoutMs');
  let timeouts;
  try {
    timeouts =
      endpoint.timeouts === undefined
        ? undefined
        : parseModelTimeoutSettings(endpoint.timeouts, DIRECT_TIMEOUT_KEYS);
  } catch {
    invalid('timeouts');
  }
  return {
    id: text(endpoint.id, 'id'),
    name: text(endpoint.name, 'name'),
    enabled: boolean(endpoint.enabled, 'enabled'),
    baseUrl: normalizeOpenAICompatibleBaseUrl(endpoint.baseUrl),
    protocol: endpoint.protocol,
    auth: parseAuth(endpoint.auth),
    ...(timeoutMs !== undefined && { timeoutMs }),
    ...(timeouts !== undefined && { timeouts }),
    maxRetries,
    models,
  };
}

/** Validate the persisted collection, including endpoint identity uniqueness. */
export function parseOpenAICompatibleEndpoints(value: unknown): OpenAICompatibleEndpoint[] {
  if (!Array.isArray(value)) invalid('endpoints');
  const endpoints = value.map(parseOpenAICompatibleEndpoint);
  if (new Set(endpoints.map((endpoint) => endpoint.id)).size !== endpoints.length) {
    invalid('endpoints (duplicate IDs)');
  }
  return endpoints;
}

/** Resolve one endpoint and exact API model without global state or network access. */
export function resolveOpenAICompatibleConnection(options: {
  endpoints?: readonly OpenAICompatibleEndpoint[];
  providerId: string;
  /** Canonical direct- ID, not a bare model ID. Strip exactly one outer prefix. */
  model: string;
  credentials?: Pick<Credentials, 'openaiCompatibleApiKeys'>;
  env?: Readonly<Record<string, string | undefined>>;
  modelTimeouts?: ModelTimeoutSettings;
}): ResolvedOpenAICompatibleConnection {
  if (!isDirectModel(options.model)) invalid('model (direct- prefix required)');
  const matches = (options.endpoints ?? []).filter((item) => item.id === options.providerId);
  if (matches.length !== 1) invalid('providerId (missing or duplicate endpoint)');
  const endpoint = parseOpenAICompatibleEndpoint(matches[0]);
  const timeouts = {
    ...parseModelTimeoutSettings(options.modelTimeouts ?? {}),
    ...endpoint.timeouts,
  };
  if (!endpoint.enabled) invalid('providerId (endpoint disabled)');
  const model = endpoint.models.find((item) => item.id === stripProviderPrefix(options.model));
  if (!model) invalid('model (not configured on endpoint)');

  let apiKey: string | undefined;
  const auth = endpoint.auth;
  if (auth.type !== 'none') {
    const source =
      auth.type === 'env'
        ? (options.env ?? process.env)
        : options.credentials?.openaiCompatibleApiKeys;
    const key = auth.type === 'env' ? auth.variableName : auth.credentialId;
    const secret = source && Object.hasOwn(source, key) ? source[key] : undefined;
    if (typeof secret !== 'string' || !secret.trim() || /[\x00-\x1f\x7f]/.test(secret)) {
      invalid('auth (configured secret missing or invalid)');
    }
    apiKey = secret.trim();
  }

  return {
    endpointId: endpoint.id,
    baseUrl: endpoint.baseUrl,
    protocol: endpoint.protocol,
    ...(apiKey !== undefined && { apiKey }),
    model,
    timeoutMs: endpoint.timeoutMs ?? timeouts.requestTimeoutMs ?? DEFAULT_DIRECT_TIMEOUT_MS,
    ...(Object.keys(timeouts).length && { timeouts }),
    maxRetries: endpoint.maxRetries ?? DEFAULT_DIRECT_MAX_RETRIES,
  };
}
