import {
  GithubAuthenticationRequestSchema,
  ClaudeVerificationRequestSchema,
  CodexVerificationRequestSchema,
  SetupCredentialProviderSchema,
  SetupCredentialStoreRequestSchema,
  SetupCredentialDeleteRequestSchema,
} from '@automaker/contracts';
import { VerificationAuthMethodSchema } from '@automaker/contracts/domains/setup-query';
import type { SetupCommandValidation } from './setup-command.port.js';
/** Composition adapter preserves exact shared parsing/refinement/normalization semantics. */
export function createSetupCommandValidation(): SetupCommandValidation {
  return Object.freeze({
    authMethod: (input: unknown) => VerificationAuthMethodSchema.safeParse(input),
    github: (input: unknown) => GithubAuthenticationRequestSchema.safeParse(input),
    claude: (input: unknown) => ClaudeVerificationRequestSchema.safeParse(input),
    codex: (input: unknown) => CodexVerificationRequestSchema.safeParse(input),
    credentialProvider: (input: unknown) => SetupCredentialProviderSchema.safeParse(input),
    credentialChange: (operation: 'store' | 'delete', input: unknown) =>
      (operation === 'store'
        ? SetupCredentialStoreRequestSchema
        : SetupCredentialDeleteRequestSchema
      ).safeParse(input),
  });
}
