import { Inject, Injectable } from '@nestjs/common';
import type { EventHistoryFilter } from '@automaker/types';
import { NotFoundDomainError } from '../../core/errors/index.js';
import { EventHistoryService } from '../../services/event-history-service.js';
import type {
  EventByIdRequest,
  EventListRequest,
  EventProjectRequest,
} from './event-history.schemas.js';

@Injectable()
export class EventHistoryApplicationService {
  constructor(@Inject(EventHistoryService) private readonly history: EventHistoryService) {}

  async list({ projectPath, filter }: EventListRequest): Promise<Record<string, unknown>> {
    const typedFilter = filter as EventHistoryFilter | undefined;
    const [events, total] = await Promise.all([
      this.history.getEvents(projectPath, typedFilter),
      this.history.getEventCount(projectPath, {
        ...typedFilter,
        limit: undefined,
        offset: undefined,
      }),
    ]);
    return { success: true, events, total };
  }

  async get(input: EventByIdRequest): Promise<Record<string, unknown>> {
    const event = await this.requireEvent(input);
    return { success: true, event };
  }

  async delete({ projectPath, eventId }: EventByIdRequest): Promise<Record<string, unknown>> {
    if (!(await this.history.deleteEvent(projectPath, eventId)))
      throw new NotFoundDomainError('Event not found');
    return { success: true };
  }

  async clear({ projectPath }: EventProjectRequest): Promise<Record<string, unknown>> {
    return { success: true, cleared: await this.history.clearEvents(projectPath) };
  }

  requireEvent({ projectPath, eventId }: EventByIdRequest) {
    return this.history.getEvent(projectPath, eventId).then((event) => {
      if (!event) throw new NotFoundDomainError('Event not found');
      return event;
    });
  }
}
