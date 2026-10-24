import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModulesContainer } from '@nestjs/core';
import { expect, it } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { SettingsFileRepository } from '../../src/modules/settings/settings-file.repository.js';
import { SettingsQueryService } from '../../src/modules/settings/settings-query.service.js';
import { SettingsCommandService } from '../../src/modules/settings/settings-command.service.js';
import { ApplicationCredentialsService } from '../../src/modules/providers/application-credentials.service.js';
import { LoginAttemptStore } from '../../src/core/auth/login-attempt.store.js';
import { AuthController } from '../../src/core/auth/auth.controller.js';
import { APPLICATION_EVENTS } from '../../src/core/eventing/application-events.js';
import { EVENT_BUS, type EventBus } from '../../src/core/eventing/event-bus.js';
import type { EventEmitter } from '../../src/lib/events.js';

it('owns settings, auth attempts and event transport natively once per application, preserves persistence and disposes only its own typed subscriptions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-foundation-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const unsubscribers: Array<() => void> = [];
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
      SettingsService,
      SettingsFileRepository,
      LoginAttemptStore,
      APPLICATION_EVENTS,
      EVENT_BUS,
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
      expect(runtime.legacy).not.toHaveProperty('services');
      const settings = runtime.app.get(SettingsService);
      expect((settings as unknown as { files: unknown }).files).toBe(
        runtime.app.get(SettingsFileRepository)
      );
      for (const consumer of [
        SettingsQueryService,
        SettingsCommandService,
        ApplicationCredentialsService,
      ])
        expect((runtime.app.get(consumer) as unknown as { settings: unknown }).settings).toBe(
          settings
        );
      expect((runtime.app.get(AuthController) as unknown as { attempts: unknown }).attempts).toBe(
        runtime.app.get(LoginAttemptStore)
      );
      expect(runtime.legacy.events).toBe(runtime.app.get(APPLICATION_EVENTS));
    }
    const one = first.app.get(SettingsService),
      two = second.app.get(SettingsService);
    expect(one.getDataDirectory()).not.toBe(two.getDataDirectory());
    const baseline = (await two.getGlobalSettings()).enableRequestLogging;
    await one.updateGlobalSettings({ enableRequestLogging: false });
    expect((await one.getGlobalSettings()).enableRequestLogging).toBe(false);
    expect((await two.getGlobalSettings()).enableRequestLogging).toBe(baseline);

    const attempts = first.app.get(LoginAttemptStore);
    for (let i = 0; i < 5; i++) attempts.recordFailure('fixture', 1_000);
    expect(attempts.check('fixture', 1_001).allowed).toBe(false);
    expect(second.app.get(LoginAttemptStore).check('fixture', 1_001).allowed).toBe(true);

    const oneTyped: string[] = [],
      oneRaw: unknown[] = [],
      twoTyped: string[] = [];
    const bus = first.app.get<EventBus>(EVENT_BUS),
      otherBus = second.app.get<EventBus>(EVENT_BUS);
    const raw = first.app.get<EventEmitter>(APPLICATION_EVENTS);
    bus.subscribe('feature:progress', ({ featureId }) => oneTyped.push(featureId));
    otherBus.subscribe('feature:progress', ({ featureId }) => twoTyped.push(featureId));
    unsubscribers.push(
      raw.subscribe((type, payload) => {
        if (type === 'feature:progress') oneRaw.push(payload);
      })
    );
    raw.emit('feature:progress', { featureId: 'raw' });
    bus.emit('feature:progress', { featureId: 'typed' });
    expect(oneTyped).toEqual(['raw', 'typed']);
    expect(oneRaw).toEqual([{ featureId: 'raw' }, { featureId: 'typed' }]);
    expect(twoTyped).toEqual([]);
    await first.app.close();
    raw.emit('feature:progress', { featureId: 'after-close' });
    expect(oneTyped).toEqual(['raw', 'typed']);
    otherBus.emit('feature:progress', { featureId: 'still-live' });
    expect(twoTyped).toEqual(['still-live']);

    const restarted = await start('one');
    expect(
      (await restarted.app.get(SettingsService).getGlobalSettings()).enableRequestLogging
    ).toBe(false);
    expect(restarted.app.get(LoginAttemptStore).check('fixture', 1_001).allowed).toBe(true);
    expect(restarted.app.get(APPLICATION_EVENTS)).not.toBe(raw);
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
    await Promise.all(apps.map(({ app }) => app.close()));
    await rm(directory, { recursive: true, force: true });
  }
});
