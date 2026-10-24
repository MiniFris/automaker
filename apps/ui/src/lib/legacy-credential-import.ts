export const LEGACY_CREDENTIAL_PROVIDERS = ['anthropic', 'google', 'openai'] as const;
export type LegacyCredentialProvider = (typeof LEGACY_CREDENTIAL_PROVIDERS)[number];

/** Read only. Never mutate the browser backup or upload it as a bulk credential record. */
export function inspectLegacyCredentials(
  raw: string | null
): Partial<Record<LegacyCredentialProvider, string>> {
  if (!raw) return {};
  if (raw.length > 1024 * 1024) throw new Error('Legacy settings exceed the inspection limit.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Legacy settings could not be inspected.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Legacy settings could not be inspected.');
  const state = Object.hasOwn(parsed, 'state') ? (parsed as { state: unknown }).state : parsed;
  if (!state || typeof state !== 'object' || Array.isArray(state))
    throw new Error('Legacy settings could not be inspected.');
  const keys = Object.hasOwn(state, 'apiKeys')
    ? (state as { apiKeys?: unknown }).apiKeys
    : undefined;
  if (keys === undefined) return {};
  if (!keys || typeof keys !== 'object' || Array.isArray(keys))
    throw new Error('Legacy credentials could not be inspected.');
  const candidates: Partial<Record<LegacyCredentialProvider, string>> = {};
  for (const provider of LEGACY_CREDENTIAL_PROVIDERS) {
    if (!Object.hasOwn(keys, provider)) continue;
    const value = (keys as Record<string, unknown>)[provider];
    if (typeof value !== 'string' || !value.trim()) continue;
    if (value.length > 8192) throw new Error('Legacy credential exceeds the inspection limit.');
    candidates[provider] = value.trim();
  }
  return candidates;
}
