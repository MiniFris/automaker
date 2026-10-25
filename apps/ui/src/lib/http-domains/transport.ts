import type { EventCallback, EventType } from '../http-api-client';

/** Bound methods keep authentication, errors and WebSocket ownership in one client. */
export interface HttpDomainTransport {
  post<T>(endpoint: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  get<T>(endpoint: string): Promise<T>;
  put<T>(endpoint: string, body?: unknown): Promise<T>;
  httpDelete<T>(endpoint: string, body?: unknown): Promise<T>;
  subscribeToEvent(type: EventType, callback: EventCallback): () => void;
}
