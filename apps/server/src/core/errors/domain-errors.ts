export type DomainErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'UNKNOWN_OUTCOME'
  | 'RATE_LIMITED';

export class DomainError extends Error {
  constructor(
    message: string,
    readonly errorCode: DomainErrorCode,
    readonly statusCode: number
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class ValidationDomainError extends DomainError {
  constructor(message = 'Invalid request.') {
    super(message, 'VALIDATION_ERROR', 400);
  }
}
export class NotFoundDomainError extends DomainError {
  constructor(message = 'Resource not found.') {
    super(message, 'NOT_FOUND', 404);
  }
}
export class ConflictDomainError extends DomainError {
  constructor(message = 'Request conflicts with current state.') {
    super(message, 'CONFLICT', 409);
  }
}
export class ForbiddenDomainError extends DomainError {
  constructor(message = 'Permission denied.') {
    super(message, 'FORBIDDEN', 403);
  }
}
export class UnauthorizedDomainError extends DomainError {
  constructor(message = 'Authentication required.') {
    super(message, 'UNAUTHORIZED', 401);
  }
}
export class UnavailableDomainError extends DomainError {
  constructor(message = 'Service unavailable.') {
    super(message, 'UNAVAILABLE', 503);
  }
}
export class TimeoutDomainError extends DomainError {
  constructor(message = 'Operation timed out.') {
    super(message, 'TIMEOUT', 504);
  }
}
export class CancellationDomainError extends DomainError {
  constructor(message = 'Operation cancelled.') {
    super(message, 'CANCELLED', 409);
  }
}
export class RateLimitDomainError extends DomainError {
  constructor(message = 'Too many requests.') {
    super(message, 'RATE_LIMITED', 429);
  }
}
export class UnknownOutcomeDomainError extends DomainError {
  constructor(message = 'Operation outcome is unknown.') {
    super(message, 'UNKNOWN_OUTCOME', 502);
  }
}

export function mapInfrastructureError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'FILESYSTEM_CLOSED' || code === 'FILESYSTEM_BUSY')
    return new UnavailableDomainError('Filesystem is not accepting operations.');
  const message = error instanceof Error ? error.message : String(error);
  if (code === 'ENOENT') return new NotFoundDomainError('Resource not found.');
  if (code === 'EACCES' || code === 'EPERM') return new ForbiddenDomainError('Permission denied.');
  if (code === 'ETIMEDOUT' || /timed?\s*out/i.test(message)) return new TimeoutDomainError();
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code))
    return new UnavailableDomainError();
  if (/conflict|would overwrite|non-fast-forward/i.test(message)) return new ConflictDomainError();
  if (/cancelled|canceled|aborted/i.test(message)) return new CancellationDomainError();
  return new UnknownOutcomeDomainError();
}
