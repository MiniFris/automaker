/**
 * Event History Service - Stores and retrieves event records for debugging and replay
 *
 * Provides persistent storage for events in {projectPath}/.automaker/events/
 * Each event is stored as a separate JSON file with an index for quick listing.
 *
 * Features:
 * - Store events when they occur
 * - List and filter historical events
 * - Replay events to test hook configurations
 * - Delete old events to manage disk space
 */

import { createLogger } from '@automaker/utils';
import { ProjectEventStorage, type ProjectEventFilesystem } from './project-event-storage.js';
import { UnknownOutcomeDomainError, ValidationDomainError } from '../core/errors/index.js';
import { getEventHistoryIndexPath, getEventPath } from '@automaker/platform';
import type {
  StoredEvent,
  StoredEventIndex,
  StoredEventSummary,
  EventHistoryFilter,
  EventHookTrigger,
} from '@automaker/types';
import { DEFAULT_EVENT_HISTORY_INDEX } from '@automaker/types';
import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';

const logger = createLogger('EventHistoryService');

/** Maximum events to keep in the index (oldest are pruned) */
const MAX_EVENTS_IN_INDEX = 1000;

const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id !== 'index' && !/[\\/\0]/.test(id);
const validIndex = (value: unknown): value is StoredEventIndex => {
  const index = value as Partial<StoredEventIndex> | null;
  return (
    !!index &&
    index.version === 1 &&
    Array.isArray(index.events) &&
    index.events.every(
      (event) =>
        !!event &&
        validId(event.id) &&
        typeof event.trigger === 'string' &&
        typeof event.timestamp === 'string'
    )
  );
};
const validEvent = (value: unknown): value is StoredEvent => {
  const event = value as Partial<StoredEvent> | null;
  return (
    !!event &&
    validId(event.id) &&
    typeof event.trigger === 'string' &&
    typeof event.timestamp === 'string' &&
    typeof event.projectPath === 'string'
  );
};

/**
 * Input for storing a new event
 */
export interface StoreEventInput {
  trigger: EventHookTrigger;
  projectPath: string;
  featureId?: string;
  featureName?: string;
  error?: string;
  errorType?: string;
  passes?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * EventHistoryService - Manages persistent storage of events
 */
@Injectable()
export class EventHistoryService {
  private readonly storage: ProjectEventStorage;

  constructor(filesystem: ProjectEventFilesystem, canonicalProject: (project: string) => string) {
    this.storage = new ProjectEventStorage(filesystem, 'Event history', canonicalProject);
  }

  beforeApplicationShutdown(): Promise<void> {
    return this.storage.close();
  }

  private eventPath(project: string, id: string): string {
    if (!validId(id)) throw new ValidationDomainError('Invalid event ID.');
    return getEventPath(project, id);
  }
  /**
   * Store a new event to history
   *
   * @param input - Event data to store
   * @returns Promise resolving to the stored event
   */
  async storeEvent(input: StoreEventInput): Promise<StoredEvent> {
    return this.storage.run(input.projectPath, async () => {
      const { projectPath, trigger, featureId, featureName, error, errorType, passes, metadata } =
        input;

      const indexPath = getEventHistoryIndexPath(projectPath);
      const index = await this.storage.read(indexPath, DEFAULT_EVENT_HISTORY_INDEX, validIndex);

      const eventId = `evt-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const timestamp = new Date().toISOString();
      const projectName = this.extractProjectName(projectPath);

      const event: StoredEvent = {
        id: eventId,
        trigger,
        timestamp,
        projectPath,
        projectName,
        featureId,
        featureName,
        error,
        errorType,
        passes,
        metadata,
      };

      // Write the full event to its own file
      const eventPath = this.eventPath(projectPath, eventId);
      index.events.unshift({
        id: event.id,
        trigger: event.trigger,
        timestamp: event.timestamp,
        featureName: event.featureName,
        featureId: event.featureId,
      });
      const removed = index.events.splice(MAX_EVENTS_IN_INDEX);
      await this.storage.write(eventPath, event);
      try {
        await this.storage.write(indexPath, index);
      } catch (error) {
        let committed: StoredEventIndex;
        try {
          committed = await this.storage.read(indexPath, DEFAULT_EVENT_HISTORY_INDEX, validIndex);
        } catch {
          throw new UnknownOutcomeDomainError('Event index commit could not be confirmed.');
        }
        // An IO failure can be reported after rename committed. Keep any referenced event.
        try {
          if (!committed.events.some((item) => item.id === eventId))
            await this.storage.remove(eventPath);
        } catch {
          throw new UnknownOutcomeDomainError('Event publication cleanup could not be confirmed.');
        }
        throw error;
      }
      // The committed index is authoritative. Never remove a still-referenced event.
      for (const oldEvent of removed)
        await this.storage.remove(this.eventPath(projectPath, oldEvent.id));

      logger.info(`Stored event ${eventId} (${trigger}) for project ${projectName}`);

      return event;
    });
  }

  /**
   * Get all events for a project with optional filtering
   *
   * @param projectPath - Absolute path to project directory
   * @param filter - Optional filter criteria
   * @returns Promise resolving to array of event summaries
   */
  async getEvents(projectPath: string, filter?: EventHistoryFilter): Promise<StoredEventSummary[]> {
    return this.storage.run(projectPath, async () => {
      const indexPath = getEventHistoryIndexPath(projectPath);
      const index = await this.storage.read<StoredEventIndex>(
        indexPath,
        DEFAULT_EVENT_HISTORY_INDEX,
        validIndex
      );

      let events = [...index.events];

      // Apply filters
      if (filter) {
        if (filter.trigger) {
          events = events.filter((e) => e.trigger === filter.trigger);
        }
        if (filter.featureId) {
          events = events.filter((e) => e.featureId === filter.featureId);
        }
        if (filter.since) {
          const sinceDate = new Date(filter.since).getTime();
          events = events.filter((e) => new Date(e.timestamp).getTime() >= sinceDate);
        }
        if (filter.until) {
          const untilDate = new Date(filter.until).getTime();
          events = events.filter((e) => new Date(e.timestamp).getTime() <= untilDate);
        }
      }

      // Sort by timestamp (newest first)
      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply pagination
      if (filter?.offset) {
        events = events.slice(filter.offset);
      }
      if (filter?.limit) {
        events = events.slice(0, filter.limit);
      }

      return events;
    });
  }

  /**
   * Get a single event by ID
   *
   * @param projectPath - Absolute path to project directory
   * @param eventId - Event identifier
   * @returns Promise resolving to the full event or null if not found
   */
  async getEvent(projectPath: string, eventId: string): Promise<StoredEvent | null> {
    return this.storage.run(projectPath, async () => {
      const file = this.eventPath(projectPath, eventId);
      const event = await this.storage.read<StoredEvent | null>(file, null, validEvent);
      if (event && event.id !== eventId)
        throw new SyntaxError('Stored event identity is inconsistent.');
      return event;
    });
  }

  /**
   * Delete an event by ID
   *
   * @param projectPath - Absolute path to project directory
   * @param eventId - Event identifier
   * @returns Promise resolving to true if deleted
   */
  async deleteEvent(projectPath: string, eventId: string): Promise<boolean> {
    return this.storage.run(projectPath, async () => {
      const eventPath = this.eventPath(projectPath, eventId);
      const indexPath = getEventHistoryIndexPath(projectPath);
      const index = await this.storage.read(indexPath, DEFAULT_EVENT_HISTORY_INDEX, validIndex);
      const remaining = index.events.filter((event) => event.id !== eventId);
      if (remaining.length === index.events.length) return false;
      await this.storage.write(indexPath, { ...index, events: remaining });
      await this.storage.remove(eventPath);
      logger.info(`Deleted event ${eventId}`);
      return true;
    });
  }

  /**
   * Clear all events for a project
   *
   * @param projectPath - Absolute path to project directory
   * @returns Promise resolving to number of events cleared
   */
  async clearEvents(projectPath: string): Promise<number> {
    return this.storage.run(projectPath, async () => {
      const indexPath = getEventHistoryIndexPath(projectPath);
      const index = await this.storage.read(indexPath, DEFAULT_EVENT_HISTORY_INDEX, validIndex);
      await this.storage.write(indexPath, DEFAULT_EVENT_HISTORY_INDEX);
      for (const event of index.events)
        await this.storage.remove(this.eventPath(projectPath, event.id));
      logger.info(`Cleared ${index.events.length} events for project`);
      return index.events.length;
    });
  }

  /**
   * Get event count for a project
   *
   * @param projectPath - Absolute path to project directory
   * @param filter - Optional filter criteria
   * @returns Promise resolving to event count
   */
  async getEventCount(projectPath: string, filter?: EventHistoryFilter): Promise<number> {
    const events = await this.getEvents(projectPath, {
      ...filter,
      limit: undefined,
      offset: undefined,
    });
    return events.length;
  }

  /**
   * Extract project name from path
   */
  private extractProjectName(projectPath: string): string {
    const parts = projectPath.split(/[/\\]/);
    return parts[parts.length - 1] || projectPath;
  }
}
