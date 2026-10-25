/** Stable fallback categories; specific domain errorCode and infrastructure code remain authoritative. */
export function httpErrorCode(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 405:
      return 'METHOD_NOT_ALLOWED';
    case 408:
    case 504:
      return 'TIMEOUT';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 429:
      return 'RATE_LIMITED';
    case 502:
      return 'UPSTREAM_ERROR';
    case 503:
      return 'UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR';
  }
}
