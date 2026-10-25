import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { RunningAgentsResponseSchema } from '@automaker/contracts/domains/running-agents';
import { createNestApplication } from '../../src/main.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { RunningAgentsService } from '../../src/modules/agents/running-agents.service.js';

let root: string;
let runtime: Awaited<ReturnType<typeof createNestApplication>>;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'automaker-running-wire-'));
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
      USERPROFILE: root,
      XDG_CONFIG_HOME: path.join(root, 'config'),
      ALLOWED_ROOT_DIRECTORY: root,
      AUTOMAKER_API_KEY: 'running-contract-fixture',
    },
  });
  await runtime.start();
});
afterAll(async () => {
  await runtime?.app.close();
  if (root) await rm(root, { recursive: true, force: true });
});
async function request() {
  const response = await fetch(
    `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/running-agents`,
    {
      headers: { 'X-API-Key': 'running-contract-fixture' },
    }
  );
  return { status: response.status, body: await response.json() };
}
const agent = (index: number) => ({
  featureId: `feature-${index}`,
  projectPath: `/project-${index}`,
  projectName: `project-${index}`,
  isAutoMode: index % 2 === 0,
  title: `Feature ${index}`,
  description: `Description ${index}`,
  model: index % 3 === 0 ? 'claude-sonnet-4-20250514' : 'claude-haiku-4-5',
  provider: 'claude',
});
const cases = [
  ['empty', []],
  [
    'extensible feature labels',
    [{ ...agent(1), title: { rich: true }, description: ['stored extension'] }],
  ],
  [
    'all properties',
    [
      agent(1),
      { ...agent(2), model: 'codex-gpt-5.1', provider: 'codex', extension: { retained: true } },
    ],
  ],
  [
    'legacy absent optional properties',
    [
      {
        featureId: 'legacy-feature',
        projectPath: '/project',
        projectName: 'project',
        isAutoMode: true,
      },
    ],
  ],
  ['multiple count', Array.from({ length: 10 }, (_, index) => agent(index))],
  [
    'different projects',
    [
      { ...agent(1), projectPath: '/workspace/project-alpha', projectName: 'project-alpha' },
      { ...agent(2), projectPath: '/workspace/project-beta', projectName: 'project-beta' },
    ],
  ],
  [
    'model/provider identity',
    ['claude', 'codex', 'cursor'].map((provider, index) => ({
      ...agent(index),
      provider,
      model:
        provider === 'codex'
          ? 'codex-gpt-5.1'
          : provider === 'cursor'
            ? 'cursor-auto'
            : 'claude-sonnet-4-20250514',
    })),
  ],
] as const;
it.each(cases)(
  'preserves %s through the native read model and HTTP response',
  async (_, records) => {
    vi.spyOn(runtime.app.get(AutoModeServiceCompat), 'getRunningAgents').mockResolvedValue(
      records as never
    );
    const response = await request();
    expect(response.status).toBe(200);
    const expected = JSON.parse(
      JSON.stringify({ success: true, runningAgents: records, totalCount: records.length })
    );
    expect(response.body).toEqual(expected);
    expect(RunningAgentsResponseSchema.parse(response.body)).toEqual(expected);
  }
);
it.each([new Error('Database connection failed'), 'String error'])(
  'handles producer rejection without leaking details: %s',
  async (error) => {
    vi.spyOn(runtime.app.get(AutoModeServiceCompat), 'getRunningAgents').mockRejectedValue(error);
    const response = await request();
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, error: 'Internal server error.' });
    expect(JSON.stringify(response.body)).not.toContain('Database connection failed');
    expect(JSON.stringify(response.body)).not.toContain('String error');
  }
);
it.each([
  { success: true, runningAgents: [null], totalCount: 1 },
  { success: true, runningAgents: [agent(1)], totalCount: 9 },
])('rejects malformed native success data', async (value) => {
  vi.spyOn(runtime.app.get(RunningAgentsService), 'list').mockResolvedValue(value);
  const response = await request();
  expect(response.status).toBe(500);
  expect(response.body).toMatchObject({ success: false, error: 'Internal server error.' });
});
