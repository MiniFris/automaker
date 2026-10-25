import type {
  GithubAuthenticationInput,
  ClaudeVerificationInput,
  CodexVerificationInput,
  SetupCredentialChangeInput,
  SetupCredentialTargetValue,
} from './verification.values.js';
export type CommandValidation<T> = { success: true; data: T } | { success: false };
/** Supplied parsing authority; use cases never load HTTP schemas or Nest metadata. */
export interface SetupCommandValidation {
  authMethod(input: unknown): CommandValidation<'cli' | 'api_key'>;
  github(input: unknown): CommandValidation<GithubAuthenticationInput>;
  claude(input: unknown): CommandValidation<ClaudeVerificationInput>;
  codex(input: unknown): CommandValidation<CodexVerificationInput>;
  credentialProvider(input: unknown): CommandValidation<SetupCredentialTargetValue['provider']>;
  credentialChange(
    operation: 'store' | 'delete',
    input: unknown
  ): CommandValidation<SetupCredentialChangeInput>;
}
