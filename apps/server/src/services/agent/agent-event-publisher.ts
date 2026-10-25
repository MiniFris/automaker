import type { EventBus } from '../../core/eventing/event-bus.js';

/** Publishes the existing chat wire envelope through the application event bus. */
export class AgentEventPublisher {
  constructor(private readonly bus: Pick<EventBus, 'emit'>) {}

  publish(sessionId: string, data: Record<string, unknown>): void {
    this.bus.emit('agent:stream', { sessionId, ...data });
  }
}
