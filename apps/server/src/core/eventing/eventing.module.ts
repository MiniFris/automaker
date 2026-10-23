import { DynamicModule, Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { EventEmitter } from '../../lib/events.js';
import { EVENT_BUS, type EventBus } from './event-bus.js';
import { LegacyEventBusAdapter } from './legacy-event-bus.adapter.js';

class EventBusLifecycle implements OnApplicationShutdown {
  constructor(private readonly eventBus: EventBus) {}
  onApplicationShutdown(): void {
    this.eventBus.dispose();
  }
}

@Global()
@Module({})
export class EventingModule {
  static register(legacy: EventEmitter): DynamicModule {
    const adapter = new LegacyEventBusAdapter(legacy);
    return {
      global: true,
      module: EventingModule,
      providers: [
        { provide: EVENT_BUS, useValue: adapter },
        { provide: EventBusLifecycle, useFactory: () => new EventBusLifecycle(adapter) },
      ],
      exports: [EVENT_BUS],
    };
  }
}
