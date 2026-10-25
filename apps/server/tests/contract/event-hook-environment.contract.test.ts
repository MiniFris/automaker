import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { EVENT_BUS, type EventBus } from '../../src/core/eventing/event-bus.js';
import { SettingsService } from '../../src/services/settings-service.js';

it.skipIf(process.platform !== 'linux')(
  'runs real Local hooks in each app working directory with captured tooling env and no backend transport variables',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'native-hook-environment-'));
    const owners: Awaited<ReturnType<typeof createNestApplication>>[] = [];
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    try {
      for (const name of ['one', 'two']) {
        const cwd = path.join(root, name);
        await mkdir(cwd);
        const environment = {
          HOME: cwd,
          PATH: '/usr/bin:/bin',
          NODE_ENV: 'test',
          AUTOMAKER_API_KEY: `backend-secret-${name}`,
          DATA_DIR: `backend-data-${name}`,
          NODE_PATH: `/backend-private-modules-${name}`,
          PORT: '0',
          OWNED_HOOK_VALUE: `captured-${name}`,
          LOG_LEVEL: 'error',
          ENABLE_REQUEST_LOGGING: 'false',
        };
        const owner = await createNestApplication({
          workingDirectory: cwd,
          dataDir: path.join(cwd, 'data'),
          host: '127.0.0.1',
          port: 0,
          environment,
          runStartupTasks: false,
          providerRegistrations: [],
          enableShutdownHooks: false,
        });
        owners.push(owner);
        // The actual shell writes a relative file, proving the configured app cwd as well.
        const script = `require('node:fs').writeFileSync('hook-environment.json', JSON.stringify({ cwd: process.cwd(), value: process.env.OWNED_HOOK_VALUE, home: process.env.HOME, backend: Object.keys(process.env).filter(k => ['PORT', 'DATA_DIR', 'AUTOMAKER_API_KEY', 'NODE_PATH'].includes(k.toUpperCase())) }))`;
        await owner.app.get(SettingsService).updateGlobalSettings({
          eventHooks: [
            {
              id: 'owned-environment',
              enabled: true,
              trigger: 'auto_mode_complete',
              action: {
                type: 'shell',
                command: `exec ${quote(process.execPath)} -e ${quote(script)}`,
              },
            },
          ],
        });
        environment.OWNED_HOOK_VALUE = `mutated-input-${name}`;
        environment.HOME = root;
      }
      for (const [name, value] of Object.entries({
        OWNED_HOOK_VALUE: 'mutated-ambient',
        HOME: root,
        PORT: '49999',
        DATA_DIR: 'ambient-backend-data',
        AUTOMAKER_API_KEY: 'ambient-backend-secret',
        NODE_PATH: '/ambient-backend-modules',
      }))
        vi.stubEnv(name, value);
      for (const owner of owners)
        owner.app.get<EventBus>(EVENT_BUS).emit('auto-mode:event', { type: 'auto_mode_idle' });
      for (const name of ['one', 'two']) {
        const cwd = path.join(root, name);
        await vi.waitFor(async () => {
          expect(
            JSON.parse(await readFile(path.join(cwd, 'hook-environment.json'), 'utf8'))
          ).toEqual({
            cwd,
            value: `captured-${name}`,
            home: cwd,
            backend: [],
          });
        });
      }
    } finally {
      try {
        await Promise.all(owners.map((owner) => owner.app.close()));
      } finally {
        vi.unstubAllEnvs();
        await rm(root, { recursive: true, force: true });
      }
    }
  }
);
