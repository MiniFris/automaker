import { z } from 'zod';

/** Legacy auth ignores falsey credentials and rejects truthy non-string values in place. */
export const CredentialSlotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('absent') }).strict(),
  z.object({ kind: z.literal('string'), value: z.string() }).strict(),
  z.object({ kind: z.literal('invalid') }).strict(),
]);
export const HttpAuthenticationContextSchema = z
  .object({
    apiKeyHeader: CredentialSlotSchema,
    sessionHeader: CredentialSlotSchema,
    apiKeyQuery: CredentialSlotSchema,
    tokenQuery: CredentialSlotSchema,
    sessionCookie: CredentialSlotSchema,
  })
  .strict();
export const ClientIdentityContextSchema = z.object({ clientId: z.string() }).strict();
// JSON cookies can hold non-string legacy values; logout historically forwards truthy values.
export const SessionCookieContextSchema = z.object({ token: z.unknown().optional() }).strict();
// Only the selected string reaches logout. No trimming/nonempty requirement is introduced.
export const TerminalLogoutContextSchema = z.object({ token: z.string().optional() }).strict();
export type CredentialSlot = z.infer<typeof CredentialSlotSchema>;
export type HttpAuthenticationContext = z.infer<typeof HttpAuthenticationContextSchema>;
export type ClientIdentityContext = z.infer<typeof ClientIdentityContextSchema>;
export type SessionCookieContext = z.infer<typeof SessionCookieContextSchema>;
export type TerminalLogoutContext = z.infer<typeof TerminalLogoutContextSchema>;
