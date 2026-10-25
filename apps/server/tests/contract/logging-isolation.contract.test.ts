import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createLogger, getLogLevel, LogLevel, setLogLevel } from '@automaker/utils';
import { createNestApplication } from '../../src/main.js';
import { ApplicationLoggingPolicy } from '../../src/core/observability/logging-policy.js';
import { ModelsCatalogService } from '../../src/modules/models/models-catalog.service.js';
import { AuthService } from '../../src/core/auth/auth.service.js';
import { ApplicationMetrics } from '../../src/core/observability/application-metrics.js';

const owners: Awaited<ReturnType<typeof createNestApplication>>[] = [],
  roots: string[] = [],
  releases: Array<() => void> = [];
const original = getLogLevel();
afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  await Promise.all(owners.splice(0).map((owner) => owner.app.close()));
  vi.restoreAllMocks();
  setLogLevel(original);
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })));
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
async function fixture(level = 'debug', startup = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'logging-owner-'));
  roots.push(root);
  const owner = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    runStartupTasks: startup,
    providerRegistrations: [],
    enableShutdownHooks: false,
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      USERPROFILE: root,
      XDG_CONFIG_HOME: path.join(root, 'xdg'),
      APPDATA: path.join(root, 'appdata'),
      PATH: '/usr/bin:/bin',
      LOG_LEVEL: level,
      LOG_COLORS: 'false',
      ENABLE_REQUEST_LOGGING: 'false',
      AUTOMAKER_API_KEY: 'fixture',
      ALLOWED_ROOT_DIRECTORY: root,
    },
  });
  owners.push(owner);
  await owner.start();
  const base = `http://127.0.0.1:${owner.app.getHttpServer().address().port}`;
  const request = (route: string, id: string, body?: object) =>
    fetch(`${base}/api/${route}`, {
      method: body ? 'PUT' : 'GET',
      headers: { 'x-api-key': 'fixture', 'x-request-id': id, 'content-type': 'application/json' },
      ...(body && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
  const update = async (serverLogLevel: string, enableRequestLogging: boolean) => {
    const response = await request('settings/global', 'settings-update', {
      serverLogLevel,
      enableRequestLogging,
    });
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  };
  return { ...owner, base, request, update, policy: owner.app.get(ApplicationLoggingPolicy) };
}

it('isolates actual app requests, settings updates and parallel held callbacks while retaining legacy fallback', async () => {
  const first = await fixture(),
    second = await fixture('error');
  const output = vi.spyOn(console, 'log').mockImplementation(() => {}),
    logger = createLogger('OwnerFixture');
  await first.update('debug', false);
  await second.update('error', false);
  setLogLevel(LogLevel.WARN);
  const firstGate = gate(),
    secondGate = gate(),
    tasks: Promise<void>[] = [];
  for (const [owner, hold, label] of [
    [first, firstGate, 'A'],
    [second, secondGate, 'B'],
  ] as const)
    vi.spyOn(owner.app.get(ModelsCatalogService), 'listAvailable').mockImplementation(async () => {
      logger.debug(`before:${label}`);
      tasks.push(
        (async () => {
          await hold.promise;
          logger.info(`after:${label}`);
          logger.debug(`debug-after:${label}`);
        })()
      );
      return { success: true, models: [] };
    });
  await Promise.all(
    [
      first.request('models/available', 'parallel-A'),
      second.request('models/available', 'parallel-B'),
    ].map(async (pending) => {
      const response = await pending;
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    })
  );
  await first.update('info', false);
  firstGate.release();
  secondGate.release();
  await Promise.all(tasks);
  const markers = output.mock.calls.flat();
  expect(markers).toContain('before:A');
  expect(markers).toContain('after:A');
  expect(markers).not.toContain('before:B');
  expect(markers).not.toContain('after:B');
  expect(markers).not.toContain('debug-after:A');
  expect(second.policy.configuration.level).toBe(LogLevel.ERROR);
  expect(getLogLevel()).toBe(LogLevel.WARN);
});

it('gates only request output while correlation and metrics continue independently in two apps', async () => {
  const first = await fixture(),
    second = await fixture();
  await first.update('debug', false);
  await second.update('debug', true);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  const one = await first.request('models/available', 'A-off'),
    two = await second.request('models/available', 'B-on');
  expect(one.headers.get('x-request-id')).toBe('A-off');
  expect(two.headers.get('x-request-id')).toBe('B-on');
  await one.arrayBuffer();
  await two.arrayBuffer();
  await vi.waitFor(() =>
    expect(
      output.mock.calls.some((call) =>
        call.some(
          (value) =>
            value &&
            typeof value === 'object' &&
            'correlationId' in value &&
            value.correlationId === 'B-on'
        )
      )
    ).toBe(true)
  );
  expect(
    output.mock.calls.some((call) =>
      call.some(
        (value) =>
          value &&
          typeof value === 'object' &&
          'correlationId' in value &&
          value.correlationId === 'A-off'
      )
    )
  ).toBe(false);
  for (const owner of [first, second])
    expect(
      owner.app
        .get(ApplicationMetrics)
        .snapshot()
        .counters.some(
          (entry) => entry.name === 'http_requests_total' && entry.labels.route?.includes('models')
        )
    ).toBe(true);
});

it('binds actual websocket upgrade and shutdown to the owning application policy', async () => {
  const first = await fixture(),
    second = await fixture('error'),
    logger = createLogger('BoundaryFixture');
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  for (const [owner, label] of [
    [first, 'A'],
    [second, 'B'],
  ] as const) {
    const auth = owner.app.get(AuthService),
      original = auth.authenticateUpgrade.bind(auth);
    vi.spyOn(auth, 'authenticateUpgrade').mockImplementation((request) => {
      logger.info(`upgrade:${label}`);
      return original(request);
    });
    const socket = new WebSocket(`${owner.base.replace('http:', 'ws:')}/api/events`, {
      headers: { 'x-api-key': 'fixture' },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
    } finally {
      await new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
        socket.close();
      });
    }
    const terminal = owner.app.get(
        (await import('../../src/services/terminal-service.js')).TerminalService
      ),
      close = terminal.cleanup.bind(terminal);
    vi.spyOn(terminal, 'cleanup').mockImplementation(async () => {
      await Promise.resolve();
      logger.info(`close:${label}`);
      await close();
    });
  }
  await Promise.all([first.app.close(), second.app.close()]);
  const markers = output.mock.calls.flat();
  expect(markers).toContain('upgrade:A');
  expect(markers).toContain('close:A');
  expect(markers).not.toContain('upgrade:B');
  expect(markers).not.toContain('close:B');
});

it('loads startup settings without mutating process-global logger defaults', async () => {
  setLogLevel(LogLevel.WARN);
  const owner = await fixture('debug', true);
  expect(getLogLevel()).toBe(LogLevel.WARN);
  expect(owner.policy.configuration.level).toBe(LogLevel.INFO);
});
