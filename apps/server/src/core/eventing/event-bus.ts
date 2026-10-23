import type { EventType } from '@automaker/types';

export interface ApplicationEventMap extends Record<EventType, unknown> {
  'feature:progress': { featureId: string; progress?: number; message?: string };
  'feature:created': { featureId: string; projectPath?: string };
  'notification:created': { id: string; [key: string]: unknown };
  'dev-server:output': { [key: string]: unknown };
  'test-runner:output': { [key: string]: unknown };
}

export type EventHandler<K extends EventType> = (payload: ApplicationEventMap[K]) => void;

export interface EventBus {
  emit<K extends EventType>(type: K, payload: ApplicationEventMap[K]): void;
  subscribe<K extends EventType>(type: K, handler: EventHandler<K>): () => void;
  dispose(): void;
}

export const EVENT_BUS = Symbol('EVENT_BUS');
