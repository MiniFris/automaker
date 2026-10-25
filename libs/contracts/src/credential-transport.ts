/** Bulk settings transport must never reactivate keys or overwrite private policy. */
export const RETIRED_CREDENTIAL_WRITE = Object.freeze({
  success: false as const,
  errorCode: 'CREDENTIAL_WRITE_RETIRED' as const,
  error:
    'Bulk credential writes are retired. Use target-confirmed setup commands or endpoint-specific credential management.' as const,
});
