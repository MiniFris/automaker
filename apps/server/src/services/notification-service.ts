/**
 * Notification Service - Handles reading/writing notifications to JSON files
 *
 * Provides persistent storage for project-level notifications in
 * {projectPath}/.automaker/notifications.json
 *
 * Notifications alert users when:
 * - Features reach specific statuses (waiting_approval, verified)
 * - Long-running operations complete (spec generation)
 */

import { createLogger } from '@automaker/utils';
import { ProjectEventStorage, type ProjectEventFilesystem } from './project-event-storage.js';
import { getNotificationsPath } from '@automaker/platform';
import type { Notification, NotificationsFile, NotificationType } from '@automaker/types';
import { DEFAULT_NOTIFICATIONS_FILE } from '@automaker/types';
import type { EventEmitter } from '../lib/events.js';
import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';

const logger = createLogger('NotificationService');

const validNotifications = (value: unknown): value is NotificationsFile => {
  const file = value as Partial<NotificationsFile> | null;
  return (
    !!file &&
    file.version === 1 &&
    Array.isArray(file.notifications) &&
    file.notifications.every(
      (item) =>
        !!item &&
        typeof item.id === 'string' &&
        typeof item.createdAt === 'string' &&
        typeof item.read === 'boolean' &&
        typeof item.dismissed === 'boolean'
    )
  );
};

/**
 * Input for creating a new notification
 */
export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  featureId?: string;
  projectPath: string;
}

/**
 * NotificationService - Manages persistent storage of notifications
 *
 * Handles reading and writing notifications to JSON files with atomic operations
 * for reliability. Each project has its own notifications.json file.
 */
@Injectable()
export class NotificationService {
  private events: EventEmitter | null = null;
  private readonly storage: ProjectEventStorage;

  constructor(filesystem: ProjectEventFilesystem, canonicalProject: (project: string) => string) {
    this.storage = new ProjectEventStorage(filesystem, 'Notification', canonicalProject);
  }

  beforeApplicationShutdown(): Promise<void> {
    return this.storage.close();
  }

  /**
   * Set the event emitter for broadcasting notification events
   */
  setEventEmitter(events: EventEmitter): void {
    this.events = events;
  }

  /**
   * Get all notifications for a project
   *
   * @param projectPath - Absolute path to project directory
   * @returns Promise resolving to array of notifications
   */
  async getNotifications(projectPath: string): Promise<Notification[]> {
    return this.storage.run(projectPath, async () => {
      const notificationsPath = getNotificationsPath(projectPath);
      const file = await this.storage.read<NotificationsFile>(
        notificationsPath,
        DEFAULT_NOTIFICATIONS_FILE,
        validNotifications
      );
      // Filter out dismissed notifications and sort by date (newest first)
      return file.notifications
        .filter((n) => !n.dismissed)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });
  }

  /**
   * Get unread notification count for a project
   *
   * @param projectPath - Absolute path to project directory
   * @returns Promise resolving to unread count
   */
  async getUnreadCount(projectPath: string): Promise<number> {
    const notifications = await this.getNotifications(projectPath);
    return notifications.filter((n) => !n.read).length;
  }

  /**
   * Create a new notification
   *
   * @param input - Notification creation input
   * @returns Promise resolving to the created notification
   */
  async createNotification(input: CreateNotificationInput): Promise<Notification> {
    return this.storage.run(input.projectPath, async () => {
      const { projectPath, type, title, message, featureId } = input;

      const notificationsPath = getNotificationsPath(projectPath);
      const file = await this.storage.read<NotificationsFile>(
        notificationsPath,
        DEFAULT_NOTIFICATIONS_FILE,
        validNotifications
      );

      const notification: Notification = {
        id: randomUUID(),
        type,
        title,
        message,
        createdAt: new Date().toISOString(),
        read: false,
        dismissed: false,
        featureId,
        projectPath,
      };

      file.notifications.push(notification);
      await this.storage.write(notificationsPath, file);

      logger.info(`Created notification: ${title} for project ${projectPath}`);

      // Emit event for real-time updates
      if (this.events) {
        this.events.emit('notification:created', notification);
      }

      return notification;
    });
  }

  /**
   * Mark a notification as read
   *
   * @param projectPath - Absolute path to project directory
   * @param notificationId - ID of the notification to mark as read
   * @returns Promise resolving to the updated notification or null if not found
   */
  async markAsRead(projectPath: string, notificationId: string): Promise<Notification | null> {
    return this.storage.run(projectPath, async () => {
      const notificationsPath = getNotificationsPath(projectPath);
      const file = await this.storage.read<NotificationsFile>(
        notificationsPath,
        DEFAULT_NOTIFICATIONS_FILE,
        validNotifications
      );

      const notification = file.notifications.find((n) => n.id === notificationId);
      if (!notification) {
        return null;
      }

      notification.read = true;
      await this.storage.write(notificationsPath, file);

      logger.info(`Marked notification ${notificationId} as read`);
      return notification;
    });
  }

  /**
   * Mark all notifications as read for a project
   *
   * @param projectPath - Absolute path to project directory
   * @returns Promise resolving to number of notifications marked as read
   */
  async markAllAsRead(projectPath: string): Promise<number> {
    return this.storage.run(projectPath, async () => {
      const notificationsPath = getNotificationsPath(projectPath);
      const file = await this.storage.read<NotificationsFile>(
        notificationsPath,
        DEFAULT_NOTIFICATIONS_FILE,
        validNotifications
      );

      let count = 0;
      for (const notification of file.notifications) {
        if (!notification.read && !notification.dismissed) {
          notification.read = true;
          count++;
        }
      }

      if (count > 0) {
        await this.storage.write(notificationsPath, file);
        logger.info(`Marked ${count} notifications as read`);
      }

      return count;
    });
  }

  /**
   * Dismiss a notification
   *
   * @param projectPath - Absolute path to project directory
   * @param notificationId - ID of the notification to dismiss
   * @returns Promise resolving to true if notification was dismissed
   */
  async dismissNotification(projectPath: string, notificationId: string): Promise<boolean> {
    return this.storage.run(projectPath, async () => {
      const notificationsPath = getNotificationsPath(projectPath);
      const file = await this.storage.read<NotificationsFile>(
        notificationsPath,
        DEFAULT_NOTIFICATIONS_FILE,
        validNotifications
      );

      const notification = file.notifications.find((n) => n.id === notificationId);
      if (!notification) {
        return false;
      }

      notification.dismissed = true;
      await this.storage.write(notificationsPath, file);

      logger.info(`Dismissed notification ${notificationId}`);
      return true;
    });
  }

  /**
   * Dismiss all notifications for a project
   *
   * @param projectPath - Absolute path to project directory
   * @returns Promise resolving to number of notifications dismissed
   */
  async dismissAll(projectPath: string): Promise<number> {
    return this.storage.run(projectPath, async () => {
      const notificationsPath = getNotificationsPath(projectPath);
      const file = await this.storage.read<NotificationsFile>(
        notificationsPath,
        DEFAULT_NOTIFICATIONS_FILE,
        validNotifications
      );

      let count = 0;
      for (const notification of file.notifications) {
        if (!notification.dismissed) {
          notification.dismissed = true;
          count++;
        }
      }

      if (count > 0) {
        await this.storage.write(notificationsPath, file);
        logger.info(`Dismissed ${count} notifications`);
      }

      return count;
    });
  }
}
