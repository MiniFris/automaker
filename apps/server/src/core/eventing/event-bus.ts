import type { EventType, IssueValidationEvent } from '@automaker/types';

export interface ApplicationEventMap extends Record<EventType, unknown> {
  'issue-validation:event': IssueValidationEvent;
  'auto-mode:event': {
    type?: string;
    featureId?: string;
    featureName?: string;
    passes?: boolean;
    executionMode?: 'auto' | 'manual';
    message?: string;
    error?: string;
    errorType?: string;
    projectPath?: string;
    status?: string;
  };
  'feature:progress': { featureId: string; progress?: number; message?: string };
  'feature:created': { featureId: string; featureName?: string; projectPath?: string };
  'feature:completed': {
    featureId: string;
    featureName?: string;
    projectPath: string;
    passes?: boolean;
    message?: string;
    executionMode?: 'auto' | 'manual';
  };
  'notification:created': { id: string; [key: string]: unknown };
  'dev-server:output': { [key: string]: unknown };
  'test-runner:output': { [key: string]: unknown };
}

export type EventHandler<K extends EventType> = (payload: ApplicationEventMap[K]) => void;
export type AllEventHandler = <K extends EventType>(
  type: K,
  payload: ApplicationEventMap[K]
) => void;

export interface EventBus {
  emit<K extends EventType>(type: K, payload: ApplicationEventMap[K]): void;
  subscribe<K extends EventType>(type: K, handler: EventHandler<K>): () => void;
  subscribeAll(handler: AllEventHandler): () => void;
  dispose(): void;
}

export const EVENT_BUS = Symbol('EVENT_BUS');
