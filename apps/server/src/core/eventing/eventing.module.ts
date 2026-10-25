import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createEventEmitter, type EventEmitter } from '../../lib/events.js';
import { APPLICATION_EVENTS } from './application-events.js';
import { EVENT_BUS, type EventBus } from './event-bus.js';
import { ApplicationEventBusAdapter } from './application-event-bus.adapter.js';

class EventBusLifecycle implements OnApplicationShutdown {
  constructor(private readonly eventBus: EventBus) {}
  onApplicationShutdown(): void {
    this.eventBus.dispose();
  }
}

@Global()
@Module({
  providers: [
    { provide: APPLICATION_EVENTS, useFactory: createEventEmitter },
    {
      provide: EVENT_BUS,
      inject: [APPLICATION_EVENTS],
      useFactory: (events: EventEmitter) => new ApplicationEventBusAdapter(events),
    },
    {
      provide: EventBusLifecycle,
      inject: [EVENT_BUS],
      useFactory: (eventBus: EventBus) => new EventBusLifecycle(eventBus),
    },
  ],
  exports: [EVENT_BUS, APPLICATION_EVENTS],
})
export class EventingModule {}
