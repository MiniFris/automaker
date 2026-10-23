import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsApplicationService } from './notifications.service.js';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import { NotificationService } from '../../services/notification-service.js';

@Module({
  controllers: [NotificationsController],
  providers: [
    { provide: NotificationService, useExisting: LEGACY_SERVICES.notification },
    NotificationsApplicationService,
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
