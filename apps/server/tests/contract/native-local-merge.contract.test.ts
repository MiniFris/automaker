import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import WebSocket from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import {
  toDirectModelId,
  type ExecuteOptions,
  type Feature,
  type PipelineStep,
} from '@automaker/types';
import { createNestApplication } from '../../src/main.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { performMerge, createLocalMergeExecutor } from '../../src/services/merge-service.js';
import { HOST_ENVIRONMENT } from '../../src/core/config/index.js';
import { ExecutionEnvironmentError } from '../../src/services/execution-environment/runtime.js';
import { MockProvider } from '../helpers/mock-provider.js';

const exec = promisify(execFile);
const owners: Awaited<ReturnType<typeof createNestApplication>>[] = [];
const roots: string[] = [];
const sockets: WebSocket[] = [];
const releases: Array<() => void> = [];
afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  sockets.splice(0).forEach((socket) => socket.terminate());
  const closed = await Promise.allSettled(owners.splice(0).map((owner) => owner.app.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
const step = (id: string, order: number): PipelineStep => ({
  id,
  name: `Step ${id}`,
  instructions: `NATIVE_INSTRUCTIONS_${id}`,
  order,
  colorClass: 'blue',
  createdAt: '2026-10-25T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z',
});
async function fixture(
  control?: (stage: string, options: ExecuteOptions, index: number) => Promise<void>,
  fixtureOptions: { root?: string; finalize?: (stage: string) => Promise<void> } = {}
) {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_SYSTEM', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_TERMINAL_PROMPT', '0');
  vi.stubEnv('GIT_CONFIG_COUNT', '0');
  const root =
    fixtureOptions.root ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'native-custom-pipeline-')));
  if (!roots.includes(root)) roots.push(root);
  const project = path.join(root, 'project');
  await fs.mkdir(project, { recursive: true });
  const calls: Array<{ stage: string; options: ExecuteOptions }> = [];
  class OfflineProvider extends MockProvider {
    protected async *execute(options: ExecuteOptions) {
      const prompt =
        typeof options.prompt === 'string' ? options.prompt : JSON.stringify(options.prompt);
      const stage = /^## Pipeline Step: Step ([^\n]+)/m.exec(prompt)?.[1] ?? 'implementation';
      const index = calls.push({ stage, options });
      try {
        await control?.(stage, options, index);
        yield {
          type: 'assistant' as const,
          message: {
            role: 'assistant' as const,
            content: [
              {
                type: 'text' as const,
                text: `<summary>\n## ${stage}\n${`NATIVE_RESULT_${stage} explicit offline implementation details. `.repeat(12)}\n</summary>`,
              },
            ],
          },
        };
        yield { type: 'result' as const, subtype: 'success' as const };
      } finally {
        await fixtureOptions.finalize?.(stage);
      }
    }
  }
  const owner = await createNestApplication({
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    host: '127.0.0.1',
    port: 0,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [
      { name: 'openai-compatible', create: () => new OfflineProvider('openai-compatible') },
      { name: 'claude', create: () => new OfflineProvider('claude') },
    ],
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
      AUTOMAKER_API_KEY: 'pipeline-fixture',
      ALLOWED_ROOT_DIRECTORY: root,
      ENABLE_REQUEST_LOGGING: 'false',
      NODE_PATH: 'BACKEND_NODE_PATH',
      GIT_DIR: path.join(root, 'captured-wrong.git'),
      GIT_WORK_TREE: path.join(root, 'captured-wrong-worktree'),
    },
  });
  owners.push(owner);
  await owner.start();
  const origin = `http://127.0.0.1:${owner.app.getHttpServer().address().port}`;
  const post = async (route: string, body: object, method = 'POST') => {
    const response = await fetch(origin + '/api/' + route, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': 'pipeline-fixture' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    return result;
  };
  await post(
    'settings/global',
    {
      openaiCompatibleEndpoints: [
        {
          id: 'offline',
          name: 'Offline',
          enabled: true,
          baseUrl: 'http://127.0.0.1:9/v1',
          protocol: 'chat-completions',
          auth: { type: 'none' },
          models: [
            {
              id: 'fixture',
              displayName: 'Fixture',
              capabilities: { tools: true, streaming: false, reasoning: true },
            },
          ],
        },
      ],
    },
    'PUT'
  );
  const socket = new WebSocket(
    origin.replace('http:', 'ws:') + '/api/events?apiKey=pipeline-fixture'
  );
  sockets.push(socket);
  const events: Array<Record<string, unknown>> = [];
  const wire: string[] = [];
  socket.on('message', (raw) => {
    wire.push(raw.toString());
    const frame = JSON.parse(raw.toString());
    if (frame.type === 'auto-mode:event') events.push(frame.payload);
  });
  await once(socket, 'open');
  const runtime = owner.app.get(AutoModeServiceCompat);
  const manager = runtime.getGlobalService().getSharedServices().concurrencyManager;
  const feature = async (id: string, extra: Partial<Feature> = {}) =>
    (
      await post('features/create', {
        projectPath: project,
        feature: {
          id,
          title: 'Native custom pipeline',
          description: 'Explicit offline fixture',
          model: toDirectModelId('fixture'),
          providerId: 'offline',
          status: 'backlog',
          planningMode: 'skip',
          skipTests: true,
          thinkingLevel: 'high',
          reasoningEffort: 'high',
          ...extra,
        },
      })
    ).feature as Feature;
  const read = async (id: string) =>
    (await post('features/get', { projectPath: project, featureId: id })).feature as Feature;
  const config = async (steps: PipelineStep[]) =>
    post('pipeline/config/save', {
      projectPath: project,
      config: { version: 1, steps, retainedExtension: { key: 'opaque' } },
    });
  const idle = async (id: string, status = 'waiting_approval') => {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      if (!manager.isRunning(id) && (await read(id)).status === status) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      `Native pipeline did not finish: ${JSON.stringify({ feature: await read(id), stages: calls.map((call) => call.stage) })}`
    );
  };
  return {
    root,
    project,
    owner,
    post,
    events,
    wire,
    calls,
    feature,
    read,
    config,
    idle,
    manager,
    socket,
  };
}

const sentinel = 'PRIVATE_MERGE_DIAGNOSTIC_DO_NOT_PUBLISH';
const cleanEnv = {
  PATH: '/usr/bin:/bin',
  HOME: '/tmp',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};
const gitAt = (cwd: string, ...args: string[]) =>
  exec('/usr/bin/git', ['-C', cwd, ...args], { env: cleanEnv });
async function repository(f: Awaited<ReturnType<typeof fixture>>, hook = false) {
  const git = (...args: string[]) => gitAt(f.project, ...args);
  await git('init', '-qb', 'main');
  await git('config', 'user.name', 'Fixture');
  await git('config', 'user.email', 'fixture@example.invalid');
  await fs.writeFile(path.join(f.project, '.gitignore'), '.automaker/\n.worktrees/\n');
  await fs.writeFile(path.join(f.project, 'base'), 'base');
  await git('add', '.');
  await git('commit', '-qm', 'base');
  const worktree = path.join(f.project, '.worktrees', 'native-feature');
  await git('worktree', 'add', '-qb', 'native-feature', worktree, 'main');
  await fs.writeFile(path.join(worktree, 'result'), 'own repo');
  await gitAt(worktree, 'add', '.');
  await gitAt(worktree, 'commit', '-qm', 'feature');
  await fs.writeFile(path.join(f.project, 'main-result'), 'main repo');
  await git('add', 'main-result');
  await git('commit', '-qm', 'main diverged');
  await git('remote', 'add', 'origin', path.join(f.root, sentinel));
  const capture = path.join(f.root, 'merge-env');
  const hookFile = path.join(f.project, '.git/hooks/pre-merge-commit');
  await fs.writeFile(
    hookFile,
    `#!/bin/sh
/usr/bin/env > '${capture}'
printf '%s\n' '${sentinel}' >&2
exit ${hook ? 1 : 0}
`,
    { mode: 0o700 }
  );
  await f.config([step('late', 0)]);
  return { git, worktree, capture };
}

it.each([false, true])(
  'isolates two native legacy-Local merges and suppresses actual fetch/hook diagnostics (hook failure=%s)',
  async (hook) => {
    const logs = ['log', 'warn', 'error'].map((name) =>
      vi.spyOn(console, name as 'log').mockImplementation(() => {})
    );
    const poison = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-ambient-'));
    roots.push(poison);
    await exec('/usr/bin/git', ['init', '-qb', 'wrong-target', poison], { env: cleanEnv });
    const badTools = path.join(poison, 'bin');
    await fs.mkdir(badTools);
    const invoked = path.join(poison, 'invoked');
    await fs.writeFile(
      path.join(badTools, 'git'),
      `#!/bin/sh
printf rogue > '${invoked}'
printf '${sentinel}' >&2
exit 7
`,
      { mode: 0o700 }
    );
    const mutate = async (stage: string) => {
      if (stage === 'late') {
        vi.stubEnv('GIT_DIR', path.join(poison, '.git'));
        vi.stubEnv('GIT_WORK_TREE', poison);
        vi.stubEnv('PATH', badTools);
        vi.stubEnv('AUTOMAKER_API_KEY', 'MUTATED_BACKEND_KEY');
      }
    };
    const ambient = { ...process.env };
    const a = await fixture(mutate),
      b = await fixture(mutate);
    const ra = await repository(a, hook),
      rb = await repository(b, false);
    const before = (await ra.git('rev-parse', 'HEAD')).stdout.trim();
    const responses: unknown[] = [];
    for (const [f, r] of [
      [a, ra],
      [b, rb],
    ] as const) {
      if (f === b)
        for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'PATH', 'AUTOMAKER_API_KEY'])
          vi.stubEnv(key, ambient[key]);
      const feature = await f.feature('merge-isolation', { branchName: 'native-feature' });
      responses.push(
        await f.post('auto-mode/run-feature', {
          projectPath: f.project,
          featureId: feature.id,
          useWorktrees: true,
        })
      );
      await vi.waitFor(
        () =>
          expect(
            f.calls.map((call) => call.stage),
            JSON.stringify(logs.flatMap((log) => log.mock.calls))
          ).toContain('late'),
        {
          timeout: 7000,
        }
      );
      await vi.waitFor(() => expect(f.manager.isRunning(feature.id)).toBe(false), {
        timeout: 7000,
      });
      if (f === a && hook) expect((await r.git('rev-parse', 'HEAD')).stdout.trim()).toBe(before);
      else
        expect((await r.git('merge-base', '--is-ancestor', 'native-feature', 'HEAD')).stderr).toBe(
          ''
        );
      const env = await fs.readFile(r.capture, 'utf8');
      expect(env).not.toMatch(
        /^(?:GIT_DIR|GIT_WORK_TREE|AUTOMAKER_API_KEY|PORT|DATA_DIR|NODE_PATH)=/m
      );
      expect(env).toContain('HOME=' + f.root);
      expect(env).not.toContain('MUTATED_BACKEND_KEY');
      if (f === a) {
        a.socket.terminate();
        await a.owner.app.close();
        owners.splice(owners.indexOf(a.owner), 1);
      }
    }
    expect(await fs.stat(invoked).catch(() => null)).toBeNull();
    expect(
      JSON.stringify([...a.wire, ...b.wire, responses, ...logs.flatMap((log) => log.mock.calls)])
    ).not.toContain(sentinel);
    expect((await gitAt(poison, 'status', '--porcelain')).stdout).toBe('?? bin/\n');
  }
);

it.each([false, true])(
  'preserves actual squash semantics and suppresses failing commit diagnostics (failure=%s)',
  async (fail) => {
    const f = await fixture();
    const r = await repository(f);
    const hook = path.join(f.project, '.git/hooks/pre-commit');
    await fs.writeFile(
      hook,
      `#!/bin/sh
printf '${sentinel}' >&2
exit ${fail ? 1 : 0}
`,
      { mode: 0o700 }
    );
    const events: unknown[] = [];
    const emitter = {
      emit: (_type: string, payload: unknown) => {
        events.push(payload);
        return true;
      },
    };
    const command = createLocalMergeExecutor(
      f.owner.app.get(HOST_ENVIRONMENT),
      new AbortController().signal
    );
    const operation = performMerge(
      f.project,
      'native-feature',
      r.worktree,
      'main',
      { squash: true, message: "literal ' quote $(no-command)" },
      emitter as never,
      command
    );
    if (fail) await expect(operation).rejects.toThrow('Squash merge commit failed.');
    else {
      await expect(operation).resolves.toMatchObject({ success: true });
      expect((await r.git('log', '-1', '--format=%s')).stdout.trim()).toBe(
        "literal ' quote $(no-command)"
      );
      expect(await fs.readFile(path.join(f.project, 'result'), 'utf8')).toBe('own repo');
    }
    expect(JSON.stringify(events)).not.toContain(sentinel);
  }
);

it('awaits actual owned Git-wrapper cleanup when the current merge signal aborts a held fetch', async () => {
  const f = await fixture();
  const r = await repository(f);
  const bin = path.join(f.root, 'hold-bin');
  await fs.mkdir(bin);
  const started = path.join(f.root, 'fetch-started');
  await fs.writeFile(
    path.join(bin, 'git'),
    `#!/bin/sh
if [ "$1" = fetch ]; then
 echo $$ > '${started}'
 trap '' TERM
 while :; do /bin/sleep 1; done
fi
exec /usr/bin/git "$@"
`,
    { mode: 0o700 }
  );
  const controller = new AbortController();
  const env = f.owner.app.get(HOST_ENVIRONMENT);
  const executor = createLocalMergeExecutor(
    { ...env, PATH: bin + ':' + env.PATH },
    controller.signal
  );
  const events: unknown[] = [];
  const operation = performMerge(
    f.project,
    'native-feature',
    r.worktree,
    'main',
    undefined,
    {
      emit: (_type: string, payload: unknown) => {
        events.push(payload);
        return true;
      },
    } as never,
    executor
  );
  const outcome = operation.catch((error) => error);
  await vi.waitFor(async () => expect(await fs.readFile(started, 'utf8')).toMatch(/^\d+/));
  const pid = Number(await fs.readFile(started, 'utf8'));
  const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
  controller.abort();
  expect(await outcome).toMatchObject({ code: 'PROCESS_INTERRUPTED' });
  expect(events).toEqual([]);
  const after = await fs.readFile(`/proc/${pid}/stat`, 'utf8').catch(() => null);
  const fields = (value: string) => value.slice(value.lastIndexOf(')') + 2).split(' ');
  expect(
    after === null ||
      fields(after)[19] !== fields(stat)[19] ||
      ['Z', 'X'].includes(fields(after)[0])
  ).toBe(true);
});
