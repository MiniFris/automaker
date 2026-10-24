import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsApplicationService } from './notifications.service.js';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import type { EventEmitter } from '../../lib/events.js';
import { NotificationService } from '../../services/notification-service.js';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    {
      provide: NotificationService,
      inject: [APPLICATION_EVENTS],
      useFactory: (events: EventEmitter) => {
        const notifications = new NotificationService();
        notifications.setEventEmitter(events);
        return notifications;
      },
    },
    NotificationsApplicationService,
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
