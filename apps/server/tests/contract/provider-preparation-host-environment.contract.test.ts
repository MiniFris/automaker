import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { toDirectModelId, type ExecuteOptions } from '@automaker/types';
import { createNestApplication } from '../../src/main.js';
import { HOST_ENVIRONMENT } from '../../src/core/config/index.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { EnvironmentBindingStore } from '../../src/services/execution-environment/bindings.js';
import { prepareCliExecution } from '../../src/providers/environment-execution.js';
import {
  prepareDirectExecution,
  runDirectShellCommand,
} from '../../src/providers/openai-compatible/execution.js';
import { PlanningWorkflowContext } from '../../src/modules/app-spec/planning-workflow.context.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { MockProvider } from '../helpers/mock-provider.js';

const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
const roots: string[] = [];
afterEach(async () => {
  const closed = await Promise.allSettled(apps.splice(0).map(({ app }) => app.close()));
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
});
const model = toDirectModelId('Fixture/Exact');
async function fixture(name: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `provider-prep-${name}-`));
  roots.push(root);
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin);
  await fs.writeFile(
    path.join(bin, 'owned-provider-tool'),
    `#!/bin/sh\nprintf '%s|%s|%s|%s|%s|%s|%s\\n' '${name}' "$OWNED_HOST" "$HOME" "$PORT" "$DATA_DIR" "$AUTOMAKER_API_KEY" "$NODE_PATH"\n`,
    { mode: 0o700 }
  );
  let calls = 0;
  class OfflineProvider extends MockProvider {
    protected async *execute(options: ExecuteOptions) {
      calls++;
      const runtime =
        options.executionEnvironmentRuntime as import('../../src/services/execution-environment/runtime.js').ExecutionEnvironment;
      expect(runtime.type).toBe('local');
      const command = await runtime.exec('owned-provider-tool', options.abortController!.signal);
      expect(command.exitCode).toBe(0);
      yield {
        type: 'assistant' as const,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: command.output.trim() }],
        },
      };
    }
  }
  const environment = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    HOME: root,
    PATH: bin,
    OWNED_HOST: name,
    ALLOWED_ROOT_DIRECTORY: root,
    AUTOMAKER_API_KEY: `backend-${name}`,
    NODE_PATH: 'backend-module-path',
  };
  const app = await createNestApplication({
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    environment,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [
      { name: 'openai-compatible', create: () => new OfflineProvider('openai-compatible') },
    ],
  });
  apps.push(app);
  await app.start();
  const settings = app.app.get(SettingsService),
    host = app.app.get<Readonly<NodeJS.ProcessEnv>>(HOST_ENVIRONMENT);
  await settings.updateGlobalSettings({
    executionEnvironment: { default: { mode: 'local' }, profiles: [] },
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
            id: 'Fixture/Exact',
            displayName: 'Fixture',
            capabilities: { tools: true, streaming: false },
          },
        ],
      },
    ],
  });
  const store = new EnvironmentBindingStore(settings, undefined, undefined, host);
  return {
    app,
    root,
    environment,
    settings,
    host,
    store,
    calls: () => calls,
    expected: `${name}|${name}|${root}||||`,
  };
}
function poisonAmbient() {
  for (const [key, value] of Object.entries({
    PATH: '/no-ambient-tools',
    HOME: '/ambient-home',
    OWNED_HOST: 'ambient',
    PORT: '9999',
    DATA_DIR: '/ambient-data',
    AUTOMAKER_API_KEY: 'ambient-secret',
    NODE_PATH: 'ambient-modules',
  }))
    vi.stubEnv(key, value);
}
it.skipIf(process.platform !== 'linux')(
  'keeps pinned Direct, CLI and automatic test runtimes on two native application snapshots after ambient changes',
  async () => {
    const one = await fixture('one'),
      two = await fixture('two');
    for (const f of [one, two]) await f.store.confirm(f.root);
    poisonAmbient();
    for (const f of [one, two]) {
      f.environment.PATH = '/mutated-input';
      f.environment.OWNED_HOST = 'mutated-input';
      const abortController = new AbortController(),
        key = `fixture:${f.root}`;
      const original = await f.store.bind({
        projectPath: f.root,
        cwd: f.root,
        key,
        legacySettings: {},
        signal: abortController.signal,
      });
      const direct = await prepareDirectExecution(
        { model, prompt: 'offline', cwd: f.root, abortController },
        f.settings,
        { model, providerId: 'offline', projectPath: f.root, runKey: key },
        'agent',
        f.host
      );
      const cli = await prepareCliExecution(
        { model: 'cursor-auto', prompt: 'offline', cwd: f.root, abortController },
        f.settings,
        { model: 'cursor-auto', projectPath: f.root, runKey: key },
        f.host
      );
      for (const prepared of [direct, cli]) {
        expect(prepared.executionEnvironmentBinding).toEqual(original.binding);
        const runtime =
          prepared.executionEnvironmentRuntime as import('../../src/services/execution-environment/runtime.js').ExecutionEnvironment;
        expect(
          (await runtime.exec('owned-provider-tool', abortController.signal)).output.trim()
        ).toBe(f.expected);
      }
      expect(
        (
          await runDirectShellCommand(
            f.settings,
            f.root,
            'owned-provider-tool',
            abortController.signal,
            { projectPath: f.root, runKey: key },
            f.host
          )
        ).output.trim()
      ).toBe(f.expected);
    }
  }
);
it.skipIf(process.platform !== 'linux')(
  'native planning query port requires Local consent before provider dispatch and supplies its own environment to actual tools',
  async () => {
    const one = await fixture('one'),
      two = await fixture('two');
    poisonAmbient();
    for (const f of [one, two]) {
      const controller = new AbortController();
      const run = f.app.app.get(PlanningWorkflowContext).operation(f.root, controller.signal);
      const query = () =>
        run.query(
          {
            model,
            providerId: 'offline',
            settingsService: f.settings,
            prompt: 'Offline provider tool',
            cwd: f.root,
            abortController: controller,
            allowedTools: ['Bash'],
          },
          f.app.app.get(ProviderRegistry)
        );
      await expect(query()).rejects.toThrow('explicit server-side');
      expect(f.calls()).toBe(0);
      await f.store.confirm(f.root);
      expect((await query()).text).toBe(f.expected);
      expect(f.calls()).toBe(1);
    }
    await one.app.app.close();
    const controller = new AbortController();
    const run = two.app.app.get(PlanningWorkflowContext).operation(two.root, controller.signal);
    expect(
      (
        await run.query(
          {
            model,
            providerId: 'offline',
            settingsService: two.settings,
            prompt: 'Still usable',
            cwd: two.root,
            abortController: controller,
            allowedTools: ['Bash'],
          },
          two.app.app.get(ProviderRegistry)
        )
      ).text
    ).toBe(two.expected);
  }
);
