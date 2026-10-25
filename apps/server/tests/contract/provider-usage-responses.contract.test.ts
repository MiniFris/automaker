import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { ProviderUsageService } from '../../src/modules/providers/provider-usage.service.js';

let runtime: Awaited<ReturnType<typeof createNestApplication>>;
let root: string, base: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-wire-'));
  runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      ALLOWED_ROOT_DIRECTORY: root,
      AUTOMAKER_API_KEY: 'usage-wire',
      PATH: '/usr/bin:/bin',
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/`;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await runtime?.app.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const window = {
  limit: 0,
  used: 2.5,
  remaining: -2.5,
  usedPercent: 120,
  windowDurationMins: 300,
  resetsAt: 123,
};
const extension = { historical: null, future: { label: ['retained'] } };
const claude = {
  sessionTokensUsed: 1,
  sessionLimit: 2,
  sessionPercentage: 50,
  sessionResetTime: 'historical',
  sessionResetText: 'later',
  weeklyTokensUsed: 3,
  weeklyLimit: 4,
  weeklyPercentage: 75,
  weeklyResetTime: '',
  weeklyResetText: '',
  sonnetWeeklyTokensUsed: 1,
  sonnetWeeklyPercentage: 0,
  sonnetResetText: '',
  costUsed: null,
  costLimit: null,
  costCurrency: null,
  lastUpdated: 'old timestamp',
  userTimezone: 'UTC',
  ...extension,
};
const fixtures = [
  { route: 'claude/usage', producer: 'claudeUsage', payload: claude },
  {
    route: 'codex/usage',
    producer: 'codexUsage',
    payload: {
      rateLimits: { primary: window, planType: 'future-plan' },
      lastUpdated: 'old',
      ...extension,
    },
  },
  {
    route: 'codex/models?refresh=true',
    producer: 'codexModelCatalog',
    payload: {
      success: true,
      models: [null, 'historical', { id: 'future', ...extension }],
      cachedAt: 123,
      ...extension,
    },
  },
  {
    route: 'gemini/usage',
    producer: 'geminiUsage',
    payload: {
      authenticated: true,
      authMethod: 'cli_login',
      usedPercent: 110,
      remainingPercent: -10,
      lastUpdated: '',
      flashQuota: { usedPercent: 0, remainingPercent: 100 },
      quotaBuckets: [{ modelId: 'future', remainingFraction: 1.2, resetTime: '' }],
      ...extension,
    },
  },
  {
    route: 'gemini/status',
    producer: 'geminiStatus',
    payload: {
      success: true,
      installed: false,
      version: null,
      path: null,
      authenticated: false,
      authenticationChecked: false,
      authMethod: 'none',
      hasCredentialsFile: false,
      ...extension,
    },
  },
  {
    route: 'zai/configure',
    producer: 'zaiConfigure',
    input: { apiToken: 'offline' },
    payload: { success: true, message: 'saved', isAvailable: false, ...extension },
  },
  {
    route: 'zai/verify',
    producer: 'zaiVerify',
    input: { apiKey: 'offline' },
    payload: { success: false, authenticated: false, error: 'invalid', ...extension },
  },
  {
    route: 'zai/usage',
    producer: 'zaiUsage',
    payload: {
      quotaLimits: {
        planType: 'future-plan',
        tokens: {
          limitType: 'future',
          limit: 1,
          used: 2,
          remaining: -1,
          usedPercent: 200,
          nextResetTime: 123,
        },
      },
      usageDetails: [{ modelId: 'future', used: 2, limit: 1 }],
      lastUpdated: '',
      ...extension,
    },
  },
  {
    route: 'zai/status',
    producer: 'zaiStatus',
    payload: {
      success: true,
      available: false,
      hasApiKey: false,
      hasEnvApiKey: false,
      message: 'not configured',
      ...extension,
    },
  },
] as const;
type Fixture = (typeof fixtures)[number];
function stub(fixture: Fixture, body: unknown, status = 200) {
  const value = { status, body };
  const spy = vi.spyOn(runtime.app.get(ProviderUsageService), fixture.producer);
  spy.mockImplementation((() =>
    fixture.producer === 'zaiStatus' ? value : Promise.resolve(value)) as never);
  return spy;
}
async function call(fixture: Fixture, key = 'usage-wire', input?: unknown) {
  const body = input ?? ('input' in fixture ? fixture.input : undefined);
  const response = await fetch(base + fixture.route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}
it.each(fixtures)('preserves native usage wire payload for $route', async (fixture) => {
  const producer = stub(fixture, fixture.payload);
  expect(await call(fixture)).toEqual({ status: 200, body: fixture.payload });
  expect(producer).toHaveBeenCalledTimes(1);
  if (fixture.producer === 'codexModelCatalog') expect(producer).toHaveBeenCalledWith(true);
});
it.each(fixtures)('rejects malformed producer payload for $route', async (fixture) => {
  stub(fixture, {});
  const response = await call(fixture);
  expect(response.status).toBe(500);
  expect(response.body).toMatchObject({ success: false });
  expect(JSON.stringify(response.body)).not.toContain('Zod');
});
it('retains manual HTTP status, nullable usage and optional error variants', async () => {
  const cases = [
    [0, { error: 'unavailable', message: 'install CLI' }, 200],
    [0, { error: 'Failed to fetch Claude usage.' }, 500],
    [1, { rateLimits: null, lastUpdated: '' }, 200],
    [1, { error: 'Authentication required' }, 200],
    [2, { success: false, error: 'unavailable', message: 'install' }, 503],
    [2, { success: false, error: 'Failed to read Codex models.' }, 500],
    [
      3,
      {
        authenticated: false,
        authMethod: 'none',
        usedPercent: 0,
        remainingPercent: 100,
        lastUpdated: '',
        error: 'offline',
      },
      200,
    ],
    [4, { success: false, error: 'Failed to read Gemini status.' }, 500],
    [5, { error: 'Failed to save z.ai configuration.' }, 500],
    [6, { success: true, authenticated: true, message: 'verified' }, 200],
    [7, { quotaLimits: null, lastUpdated: '' }, 200],
    [7, { error: 'API token required', message: 'configure' }, 200],
    [7, { error: 'Failed to fetch z.ai usage.' }, 500],
  ] as const;
  for (const [index, body, status] of cases) {
    const fixture = fixtures[index];
    const producer = stub(fixture, body, status);
    expect(await call(fixture)).toEqual({ status, body });
    producer.mockRestore();
  }
});
it('keeps auth and input validation ahead of usage producers', async () => {
  for (const fixture of fixtures) {
    const producer = stub(fixture, fixture.payload);
    expect((await call(fixture, 'wrong')).status).toBe(403);
    expect(producer).not.toHaveBeenCalled();
    producer.mockRestore();
  }
  for (const index of [5, 6]) {
    const fixture = fixtures[index];
    const producer = stub(fixture, fixture.payload);
    expect((await call(fixture, 'usage-wire', {})).status).toBe(400);
    expect(producer).not.toHaveBeenCalled();
  }
});
