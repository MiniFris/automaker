import { Injectable } from '@nestjs/common';
import type { GlobalSettings } from '../../types/settings.js';

export interface GlobalSettingsUpdatedEvent {
  previous: GlobalSettings;
  current: GlobalSettings;
  changed: ReadonlySet<keyof GlobalSettings>;
}

type GlobalSettingsUpdatedHandler = (event: GlobalSettingsUpdatedEvent) => Promise<void>;

/** Awaited in-process domain events keep runtime reactions outside persistence code. */
@Injectable()
export class SettingsDomainEvents {
  private readonly globalUpdatedHandlers = new Set<GlobalSettingsUpdatedHandler>();

  onGlobalUpdated(handler: GlobalSettingsUpdatedHandler): () => void {
    this.globalUpdatedHandlers.add(handler);
    return () => this.globalUpdatedHandlers.delete(handler);
  }

  async globalUpdated(event: GlobalSettingsUpdatedEvent): Promise<void> {
    await Promise.all([...this.globalUpdatedHandlers].map((handler) => handler(event)));
  }
}
