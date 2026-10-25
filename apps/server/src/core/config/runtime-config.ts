import path from 'node:path';
import { z } from 'zod';
import { validatePreviewConfig, type PreviewConfig } from './preview-policy.js';

const booleanValue = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((value) => (value === undefined ? defaultValue : value === 'true' || value === '1'));

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional()
);

const RuntimeEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  HOSTNAME: z.string().trim().min(1).default('localhost'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3008),
  DATA_DIR: z.string().trim().min(1).default('./data'),
  ALLOWED_ROOT_DIRECTORY: optionalString,
  CORS_ORIGIN: optionalString,
  AUTOMAKER_API_KEY: optionalString,
  AUTOMAKER_DISABLE_AUTH: booleanValue(false),
  AUTOMAKER_AUTO_LOGIN: booleanValue(false),
  AUTOMAKER_HIDE_API_KEY: booleanValue(false),
  TERMINAL_ENABLED: booleanValue(true),
  TERMINAL_PASSWORD: optionalString,
  TERMINAL_MAX_SESSIONS: z.coerce.number().int().positive().max(10_000).default(1000),
  ENABLE_REQUEST_LOGGING: booleanValue(true),
  AUTOMAKER_DEBUG_RAW_OUTPUT: booleanValue(false),
  ANTHROPIC_API_KEY: optionalString,
  IS_CONTAINERIZED: booleanValue(false),
  AUTOMAKER_SKIP_SANDBOX_WARNING: booleanValue(false),
  AUTOMAKER_DOCKER_CONTROLLER: optionalString,
  AUTOMAKER_PREVIEW_PORT_FIRST: z.coerce.number().int().min(1).max(65_535).default(3100),
  AUTOMAKER_PREVIEW_PORT_LAST: z.coerce.number().int().min(1).max(65_535).default(3119),
  AUTOMAKER_PREVIEW_PUBLIC_URL: optionalString,
  AUTOMAKER_PREVIEW_BIND: optionalString,
});

export interface RuntimeConfig {
  environment: 'development' | 'test' | 'production';
  server: {
    host: string;
    hostname: string;
    port: number;
    corsOrigins: readonly string[];
    requestLogging: boolean;
  };
  auth: {
    apiKey?: string;
    disabled: boolean;
    autoLogin: boolean;
    hideApiKey: boolean;
  };
  storage: {
    dataDirectory: string;
    allowedRootDirectory?: string;
  };
  terminal: {
    enabled: boolean;
    password?: string;
    maxSessions: number;
  };
  providers: {
    debugRawOutput: boolean;
    anthropicApiKeyConfigured: boolean;
    isEnvironmentVariableConfigured(name: string): boolean;
  };
  execution: {
    containerized: boolean;
    skipSandboxWarning: boolean;
    dockerController?: string;
  };
  preview: Readonly<PreviewConfig>;
}

export class RuntimeConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(
      `Invalid server runtime configuration:\n${issues.map((issue) => `- ${issue}`).join('\n')}`
    );
    this.name = 'RuntimeConfigError';
  }
}

export function parseRuntimeConfig(
  environment: NodeJS.ProcessEnv,
  workingDirectory = process.cwd()
): RuntimeConfig {
  const result = RuntimeEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    throw new RuntimeConfigError(
      result.error.issues.map(
        (issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`
      )
    );
  }

  const value = result.data;
  if (value.AUTOMAKER_PREVIEW_PORT_FIRST > value.AUTOMAKER_PREVIEW_PORT_LAST) {
    throw new RuntimeConfigError([
      'AUTOMAKER_PREVIEW_PORT_FIRST must be less than or equal to AUTOMAKER_PREVIEW_PORT_LAST',
    ]);
  }

  let preview: Readonly<PreviewConfig>;
  try {
    preview = validatePreviewConfig({
      firstPort: value.AUTOMAKER_PREVIEW_PORT_FIRST,
      lastPort: value.AUTOMAKER_PREVIEW_PORT_LAST,
      publicUrl: value.AUTOMAKER_PREVIEW_PUBLIC_URL,
      bindAddress:
        value.AUTOMAKER_PREVIEW_BIND ?? (value.IS_CONTAINERIZED ? '0.0.0.0' : '127.0.0.1'),
    });
  } catch (error) {
    throw new RuntimeConfigError([
      error instanceof Error ? error.message : 'Invalid preview configuration.',
    ]);
  }
  return {
    environment: value.NODE_ENV,
    server: {
      host: value.HOST,
      hostname: value.HOSTNAME,
      port: value.PORT,
      corsOrigins: Object.freeze(
        value.CORS_ORIGIN?.split(',')
          .map((origin) => origin.trim())
          .filter(Boolean) ?? []
      ),
      requestLogging: value.ENABLE_REQUEST_LOGGING,
    },
    auth: {
      apiKey: value.AUTOMAKER_API_KEY,
      disabled: value.AUTOMAKER_DISABLE_AUTH,
      autoLogin: value.AUTOMAKER_AUTO_LOGIN,
      hideApiKey: value.AUTOMAKER_HIDE_API_KEY,
    },
    storage: {
      dataDirectory: path.resolve(workingDirectory, value.DATA_DIR),
      allowedRootDirectory: value.ALLOWED_ROOT_DIRECTORY
        ? path.resolve(workingDirectory, value.ALLOWED_ROOT_DIRECTORY)
        : undefined,
    },
    terminal: {
      enabled: value.TERMINAL_ENABLED,
      password: value.TERMINAL_PASSWORD,
      maxSessions: value.TERMINAL_MAX_SESSIONS,
    },
    providers: {
      debugRawOutput: value.AUTOMAKER_DEBUG_RAW_OUTPUT,
      anthropicApiKeyConfigured: Boolean(value.ANTHROPIC_API_KEY),
      isEnvironmentVariableConfigured: (name) => {
        const candidate = environment[name];
        return typeof candidate === 'string' && candidate.trim().length > 0;
      },
    },
    execution: {
      containerized: value.IS_CONTAINERIZED,
      skipSandboxWarning: value.AUTOMAKER_SKIP_SANDBOX_WARNING,
      dockerController: value.AUTOMAKER_DOCKER_CONTROLLER,
    },
    preview,
  };
}
