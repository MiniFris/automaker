import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { EventEmitter } from '../../lib/events.js';
import { LEGACY_EVENT_EMITTER } from '../../legacy/legacy.tokens.js';
import { EVENT_BUS, type EventBus } from './event-bus.js';
import { LegacyEventBusAdapter } from './legacy-event-bus.adapter.js';

class EventBusLifecycle implements OnApplicationShutdown {
  constructor(private readonly eventBus: EventBus) {}
  onApplicationShutdown(): void {
    this.eventBus.dispose();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: EVENT_BUS,
      inject: [LEGACY_EVENT_EMITTER],
      useFactory: (events: EventEmitter) => new LegacyEventBusAdapter(events),
    },
    {
      provide: EventBusLifecycle,
      inject: [EVENT_BUS],
      useFactory: (eventBus: EventBus) => new EventBusLifecycle(eventBus),
    },
  ],
  exports: [EVENT_BUS],
})
export class EventingModule {}
