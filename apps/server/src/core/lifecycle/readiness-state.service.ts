import { Injectable } from '@nestjs/common';

@Injectable()
export class ReadinessStateService {
  private state: 'starting' | 'ready' | 'failed' | 'stopping' = 'starting';
  private failure?: string;
  markReady(): void {
    this.state = 'ready';
    this.failure = undefined;
  }
  markFailed(error: unknown): void {
    this.state = 'failed';
    this.failure = error instanceof Error ? error.message : String(error);
  }
  markStopping(): void {
    this.state = 'stopping';
  }
  snapshot(): { ready: boolean; state: string; failure?: string } {
    return {
      ready: this.state === 'ready',
      state: this.state,
      ...(this.failure && { failure: this.failure }),
    };
  }
}
