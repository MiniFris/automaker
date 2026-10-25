import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsApplicationService } from './notifications.service.js';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import type { EventEmitter } from '../../lib/events.js';
import { NotificationService } from '../../services/notification-service.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';
import type { ProjectEventFilesystem } from '../../services/project-event-storage.js';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    {
      provide: NotificationService,
      inject: [APPLICATION_EVENTS, SECURE_FILESYSTEM, SecurityService],
      useFactory: (
        events: EventEmitter,
        filesystem: ProjectEventFilesystem,
        security: SecurityService
      ) => {
        const notifications = new NotificationService(filesystem, (project) =>
          security.validateLocalPath(project, 'notification storage')
        );
        notifications.setEventEmitter(events);
        return notifications;
      },
    },
    NotificationsApplicationService,
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
