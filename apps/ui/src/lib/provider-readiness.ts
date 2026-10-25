/** Availability permits an explicit execution attempt; it never certifies authentication. */
export function canAttemptCliProvider(
  status: { installed?: boolean; connected?: boolean } | null | undefined,
  auth?: {
    authenticated?: boolean;
    authenticationChecked?: boolean;
    hasApiKey?: boolean;
    hasCredentialsFile?: boolean;
    hasAuthFile?: boolean;
    hasEnvApiKey?: boolean;
    hasStoredApiKey?: boolean;
    hasStoredOAuthToken?: boolean;
  } | null
): boolean {
  return (
    status?.connected !== false &&
    !!(
      status?.installed ||
      auth?.authenticated ||
      auth?.hasApiKey ||
      auth?.hasEnvApiKey ||
      auth?.hasStoredApiKey ||
      auth?.hasStoredOAuthToken ||
      auth?.hasCredentialsFile ||
      auth?.hasAuthFile
    )
  );
}
