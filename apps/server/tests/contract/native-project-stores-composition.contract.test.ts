import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModulesContainer } from '@nestjs/core';
import { expect, it } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import { NotificationService } from '../../src/services/notification-service.js';
import { EventHistoryService } from '../../src/services/event-history-service.js';
import { FileFeatureRepository } from '../../src/modules/features/file-feature.repository.js';
import { FEATURE_REPOSITORY } from '../../src/modules/features/feature.repository.js';
import { NotificationsApplicationService } from '../../src/modules/notifications/notifications.service.js';
import { EventHistoryApplicationService } from '../../src/modules/event-history/event-history.service.js';
import { BackgroundIntegrationsLifecycle } from '../../src/modules/orchestration/background-integrations.lifecycle.js';
import { ProjectOverviewService } from '../../src/modules/projects/project-overview.service.js';
import { LEGACY_SERVICES } from '../../src/legacy/legacy.tokens.js';
import { EVENT_BUS, type EventBus } from '../../src/core/eventing/event-bus.js';

it('owns native project storage services once, shares consumer identity, preserves files and isolates notifications/events between applications and projects', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-project-stores-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const start = async (name: string) => {
    const root = path.join(directory, name);
    await mkdir(root, { recursive: true });
    const runtime = await createNestApplication({
      workingDirectory: root,
      dataDir: path.join(root, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      providerRegistrations: [],
    });
    apps.push(runtime);
    return runtime;
  };
  try {
    const first = await start('one'),
      second = await start('two');
    for (const token of [
      FeatureLoader,
      NotificationService,
      EventHistoryService,
      FileFeatureRepository,
    ]) {
      expect(first.app.get(token)).not.toBe(second.app.get(token));
      for (const runtime of apps) {
        const wrappers = [...runtime.app.get(ModulesContainer).values()]
          .flatMap((module) => [...module.providers.values()])
          .filter((entry) => entry.token === token);
        expect(wrappers).toHaveLength(1);
        expect(wrappers[0].instance).toBe(runtime.app.get(token));
      }
    }
    for (const runtime of apps) {
      for (const retired of ['featureLoader', 'notificationService', 'eventHistoryService'])
        expect(runtime.legacy.services).not.toHaveProperty(retired);
      const features = runtime.app.get(FeatureLoader),
        notifications = runtime.app.get(NotificationService),
        history = runtime.app.get(EventHistoryService);
      const inspect = (value: unknown) => value as Record<string, unknown>;
      expect(runtime.app.get(FEATURE_REPOSITORY)).toBe(runtime.app.get(FileFeatureRepository));
      expect(inspect(runtime.app.get(FileFeatureRepository)).featureLoader).toBe(features);
      expect(inspect(runtime.app.get(NotificationsApplicationService)).notifications).toBe(
        notifications
      );
      expect(inspect(runtime.app.get(EventHistoryApplicationService)).history).toBe(history);
      const background = inspect(runtime.app.get(BackgroundIntegrationsLifecycle)),
        overview = inspect(runtime.app.get(ProjectOverviewService));
      expect(background.history).toBe(history);
      expect(background.features).toBe(features);
      expect(overview.features).toBe(features);
      expect(overview.notifications).toBe(notifications);
      const auto = inspect(inspect(runtime.app.get(LEGACY_SERVICES.autoMode)).facadeOptions);
      expect(auto.featureLoader).toBe(features);
      expect(auto.notificationService).toBe(notifications);
    }
    const one = path.join(directory, 'one', 'project'),
      two = path.join(directory, 'two', 'project');
    const feature = await first.app
      .get(FileFeatureRepository)
      .create(one, { id: 'native-feature', description: 'Owned fixture', category: 'test' });
    expect((await first.app.get(FeatureLoader).get(one, feature.id))?.id).toBe(feature.id);
    expect(await second.app.get(FeatureLoader).getAll(two)).toEqual([]);
    const firstEvents: string[] = [],
      secondEvents: string[] = [];
    first.app
      .get<EventBus>(EVENT_BUS)
      .subscribe('notification:created', ({ id }) => firstEvents.push(id));
    second.app
      .get<EventBus>(EVENT_BUS)
      .subscribe('notification:created', ({ id }) => secondEvents.push(id));
    const notification = await first.app.get(NotificationService).createNotification({
      projectPath: one,
      type: 'agent_complete',
      title: 'Native fixture',
      message: 'Owned fixture',
    });
    expect(firstEvents).toEqual([notification.id]);
    expect(secondEvents).toEqual([]);
    expect(await second.app.get(NotificationService).getNotifications(two)).toEqual([]);
    const event = await first.app
      .get(EventHistoryService)
      .storeEvent({ projectPath: one, trigger: 'feature_created', featureId: feature.id });
    expect(await second.app.get(EventHistoryService).getEvents(two)).toEqual([]);
    await first.app.close();
    const remaining = await second.app.get(NotificationService).createNotification({
      projectPath: two,
      type: 'agent_complete',
      title: 'Other fixture',
      message: 'Owned fixture',
    });
    expect(secondEvents).toEqual([remaining.id]);
    expect(
      (await second.app.get(NotificationService).getNotifications(two)).map(({ id }) => id)
    ).toEqual([remaining.id]);
    const restarted = await start('one');
    expect((await restarted.app.get(FileFeatureRepository).get(one, feature.id))?.id).toBe(
      feature.id
    );
    expect(
      (await restarted.app.get(NotificationService).getNotifications(one)).map(({ id }) => id)
    ).toEqual([notification.id]);
    expect((await restarted.app.get(EventHistoryService).getEvent(one, event.id))?.featureId).toBe(
      feature.id
    );
    // Storage remains project-scoped, not partitioned by application DATA_DIR.
    expect((await second.app.get(FeatureLoader).get(one, feature.id))?.id).toBe(feature.id);
  } finally {
    await Promise.all(apps.map(({ app }) => app.close()));
    await rm(directory, { recursive: true, force: true });
  }
});
