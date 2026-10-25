import { Inject, Injectable } from '@nestjs/common';
import { NotFoundDomainError } from '../../core/errors/index.js';
import { NotificationService } from '../../services/notification-service.js';
import type {
  NotificationMutationRequest,
  NotificationProjectRequest,
} from './notifications.schemas.js';

@Injectable()
export class NotificationsApplicationService {
  constructor(@Inject(NotificationService) private readonly notifications: NotificationService) {}

  async list({ projectPath }: NotificationProjectRequest): Promise<Record<string, unknown>> {
    return { success: true, notifications: await this.notifications.getNotifications(projectPath) };
  }

  async unreadCount({ projectPath }: NotificationProjectRequest): Promise<Record<string, unknown>> {
    return { success: true, count: await this.notifications.getUnreadCount(projectPath) };
  }

  async markRead({
    projectPath,
    notificationId,
  }: NotificationMutationRequest): Promise<Record<string, unknown>> {
    if (!notificationId)
      return { success: true, count: await this.notifications.markAllAsRead(projectPath) };
    const notification = await this.notifications.markAsRead(projectPath, notificationId);
    if (!notification) throw new NotFoundDomainError('Notification not found');
    return { success: true, notification };
  }

  async dismiss({
    projectPath,
    notificationId,
  }: NotificationMutationRequest): Promise<Record<string, unknown>> {
    if (!notificationId)
      return { success: true, count: await this.notifications.dismissAll(projectPath) };
    if (!(await this.notifications.dismissNotification(projectPath, notificationId)))
      throw new NotFoundDomainError('Notification not found');
    return { success: true, dismissed: true };
  }
}
