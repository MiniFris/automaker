let requestLoggingEnabled = process.env.ENABLE_REQUEST_LOGGING !== 'false';

export function setRequestLoggingEnabled(enabled: boolean): void {
  requestLoggingEnabled = enabled;
}

export function isRequestLoggingEnabled(): boolean {
  return requestLoggingEnabled;
}
