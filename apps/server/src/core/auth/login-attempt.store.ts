import { Injectable } from '@nestjs/common';

interface LoginAttempt {
  count: number;
  windowStartedAt: number;
}

@Injectable()
export class LoginAttemptStore {
  private readonly attempts = new Map<string, LoginAttempt>();
  constructor(
    private readonly maximumAttempts = 5,
    private readonly windowMs = 60_000
  ) {}
  check(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds?: number } {
    const attempt = this.attempts.get(key);
    if (!attempt || now - attempt.windowStartedAt >= this.windowMs) return { allowed: true };
    if (attempt.count < this.maximumAttempts) return { allowed: true };
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((this.windowMs - (now - attempt.windowStartedAt)) / 1000),
    };
  }
  recordFailure(key: string, now = Date.now()): void {
    const attempt = this.attempts.get(key);
    if (!attempt || now - attempt.windowStartedAt >= this.windowMs) {
      this.attempts.set(key, { count: 1, windowStartedAt: now });
      return;
    }
    attempt.count += 1;
  }
  reset(key: string): void {
    this.attempts.delete(key);
  }
}
