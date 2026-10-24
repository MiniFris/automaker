import type { EventType } from '@automaker/types';
import type { EventEmitter } from '../../lib/events.js';
import type { ApplicationEventMap, EventBus, EventHandler } from './event-bus.js';

export class ApplicationEventBusAdapter implements EventBus {
  private readonly subscriptions = new Set<() => void>();
  constructor(private readonly events: EventEmitter) {}
  emit<K extends EventType>(type: K, payload: ApplicationEventMap[K]): void {
    this.events.emit(type, payload);
  }
  subscribe<K extends EventType>(type: K, handler: EventHandler<K>): () => void {
    const unsubscribeTransport = this.events.subscribe((emittedType, payload) => {
      if (emittedType === type) handler(payload as ApplicationEventMap[K]);
    });
    const unsubscribe = () => {
      unsubscribeTransport();
      this.subscriptions.delete(unsubscribe);
    };
    this.subscriptions.add(unsubscribe);
    return unsubscribe;
  }
  dispose(): void {
    for (const unsubscribe of [...this.subscriptions]) unsubscribe();
  }
}
