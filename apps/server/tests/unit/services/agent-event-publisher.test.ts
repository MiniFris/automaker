import { describe, expect, it } from 'vitest';
import { createEventEmitter } from '../../../src/lib/events.js';
import { LegacyEventBusAdapter } from '../../../src/core/eventing/legacy-event-bus.adapter.js';
import { AgentEventPublisher } from '../../../src/services/agent/agent-event-publisher.js';

describe('AgentEventPublisher application event bus compatibility', () => {
  it('publishes exactly one legacy envelope and one typed bus notification in order', () => {
    const legacy = createEventEmitter();
    const bus = new LegacyEventBusAdapter(legacy);
    const publisher = new AgentEventPublisher(bus);
    const wire: unknown[] = [],
      typed: unknown[] = [];
    legacy.subscribe((type, payload) => wire.push({ type, payload }));
    bus.subscribe('agent:stream', (payload) => typed.push(payload));
    publisher.publish('session-1', { type: 'stream', messageId: 'message-1', content: 'Reply' });
    publisher.publish('session-1', { type: 'complete', messageId: 'message-1', content: 'Reply' });
    expect(typed).toEqual([
      { sessionId: 'session-1', type: 'stream', messageId: 'message-1', content: 'Reply' },
      { sessionId: 'session-1', type: 'complete', messageId: 'message-1', content: 'Reply' },
    ]);
    expect(wire).toEqual(typed.map((payload) => ({ type: 'agent:stream', payload })));
    bus.dispose();
  });
  it('does not leak events between independent applications or mutate payloads', () => {
    const first = createEventEmitter(),
      second = createEventEmitter();
    const received: unknown[] = [];
    second.subscribe((_type, payload) => received.push(payload));
    const data = { type: 'started' };
    new AgentEventPublisher(first).publish('first', data);
    expect(received).toEqual([]);
    expect(data).toEqual({ type: 'started' });
  });
});
