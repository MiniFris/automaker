import type { HttpDomainTransport } from './transport';
import type { NotificationsAPI } from '../electron';
import type { Notification } from '@automaker/types';
import type { EventCallback } from '../http-api-client';

export function createNotificationsClient(
  transport: Pick<HttpDomainTransport, 'post' | 'subscribeToEvent'>
): NotificationsAPI & {
  onNotificationCreated: (callback: (notification: Notification) => void) => () => void;
} {
  return {
    list: (projectPath: string) => transport.post('/api/notifications/list', { projectPath }),

    getUnreadCount: (projectPath: string) =>
      transport.post('/api/notifications/unread-count', { projectPath }),

    markAsRead: (projectPath: string, notificationId?: string) =>
      transport.post('/api/notifications/mark-read', { projectPath, notificationId }),

    dismiss: (projectPath: string, notificationId?: string) =>
      transport.post('/api/notifications/dismiss', { projectPath, notificationId }),

    onNotificationCreated: (callback: (notification: Notification) => void): (() => void) => {
      return transport.subscribeToEvent('notification:created', callback as EventCallback);
    },
  };
}
