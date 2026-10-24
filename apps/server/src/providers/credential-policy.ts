import type { Credentials } from '@automaker/types';

export type SetupCredentialProvider = 'anthropic' | 'openai' | 'google' | 'anthropic_oauth_token';
export const SETUP_CREDENTIAL_ENV = Object.freeze({
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  anthropic_oauth_token: 'CLAUDE_CODE_OAUTH_TOKEN',
});

export function validateCredentialPolicy(credentials: Credentials): void {
  if (
    credentials.anthropicOAuthToken !== undefined &&
    typeof credentials.anthropicOAuthToken !== 'string'
  )
    throw new Error('Application credential policy is invalid.');
  const policy = credentials.disabledBootstrapApiKeys;
  if (
    policy !== undefined &&
    (!policy ||
      typeof policy !== 'object' ||
      Array.isArray(policy) ||
      Object.entries(policy).some(
        ([key, value]) => !Object.hasOwn(SETUP_CREDENTIAL_ENV, key) || typeof value !== 'boolean'
      ))
  )
    throw new Error('Application credential policy is invalid.');
}

export function resolveApplicationKey(
  credentials: Credentials,
  environment: Readonly<NodeJS.ProcessEnv>,
  provider: SetupCredentialProvider
): string | undefined {
  validateCredentialPolicy(credentials);
  const managed =
    provider === 'anthropic_oauth_token'
      ? credentials.anthropicOAuthToken
      : credentials.apiKeys[provider];
  if (managed !== undefined && typeof managed !== 'string')
    throw new Error('Application credentials are invalid.');
  return (
    managed?.trim() ||
    (credentials.disabledBootstrapApiKeys?.[provider]
      ? undefined
      : environment[SETUP_CREDENTIAL_ENV[provider]])
  );
}
