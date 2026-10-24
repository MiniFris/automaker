import { createTestProviderRegistry } from '../helpers/provider-registry.js';
import {
  createTestAgentState,
  createTestAgentProviders,
  createTestAgentEvents,
} from '../helpers/agent-state.js';
import { AgentService } from '@/services/agent-service.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { once } from 'node:events';
import {
  ManagedDocker,
  DockerExecutionEnvironment,
} from '@/services/execution-environment/docker.js';
import { runDocker, type DockerRunner } from '@/services/execution-environment/docker-command.js';
import { SettingsService } from '@/services/settings-service.js';
import { EnvironmentBindingStore } from '@/services/execution-environment/bindings.js';
import type { DockerProjectBinding } from '@automaker/types';
import { toDirectModelId, stripProviderPrefix } from '@automaker/types';
import { parseFrontmatter } from '@automaker/utils';
import { sdkInstallerFixture } from '../helpers/remote-sdk-fixture.js';
import {
  prepareDirectExecution,
  runDirectShellCommand,
} from '@/providers/openai-compatible/execution.js';
import { ProviderSetupService } from '@/services/execution-environment/provider-setup.js';
import { providerManifest } from '@/services/execution-environment/provider-catalog.js';
import { FeatureWorkspaceService } from '@/services/execution-environment/feature-workspace.js';
import { FeatureLoader } from '@/services/feature-loader.js';
import { AutoModeServiceFacade } from '@/services/auto-mode/facade.js';
import { WorktreeResolver } from '@/services/worktree-resolver.js';
import { PipelineOrchestrator } from '@/services/pipeline-orchestrator.js';
import { TypedEventBus } from '@/services/typed-event-bus.js';
import { EventHookService } from '@/services/event-hook-service.js';
import { createEventEmitter } from '@/lib/events.js';
import { ProjectGitService } from '@/services/execution-environment/project-git.js';
import { ManagedTerminalPty } from '@/services/execution-environment/terminal.js';
import { ManagedTestRunnerService } from '@/services/execution-environment/test-runner.js';
import { ManagedDevServerService } from '@/services/execution-environment/dev-server.js';

// Opt-in. Requires an ALREADY LOCAL Node22/Git image; never pulls a base image or
// rebuilds the running application. Production builds the dedicated managed image.
const base = process.env.MANAGED_DOCKER_TEST_BASE_IMAGE;
describe.skipIf(!base || process.platform !== 'linux')('real managed Docker Engine', () => {
  let temporary: string, project: string, manager: ManagedDocker, settings: SettingsService;
  const bindings: DockerProjectBinding[] = [];
  const tag = `automaker-execution-test:${randomUUID()}`;
  const volume = `automaker-execution-test-${randomUUID()}`;
  let volumeCreated = false;
  const runner: DockerRunner = async (args, options = {}) => {
    const rewritten = args.map((arg) => (arg === 'automaker-execution:worker-1' ? tag : arg));
    if (args[0] === 'inspect' && process.env.AUTOMAKER_DOCKER_CONTROLLER === 'test-controller')
      return {
        code: 0,
        stdout: JSON.stringify([
          {
            Type: 'volume',
            Name: volume,
            Source: '/daemon/volume',
            Destination: temporary,
            RW: true,
          },
        ]),
        stderr: '',
      };
    if (args[0] === 'build') {
      // Parent is already local. PTY opt-in installs Python only in this owned test image;
      // normal fixture runs retain the no-install derived image used by earlier phases.
      return runDocker(rewritten, {
        ...options,
        input: `FROM ${base}\n${process.env.MANAGED_TERMINAL_TEST === 'true' ? 'USER root\nRUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*\n' : ''}LABEL dev.automaker.worker="1"\nENV PATH="/tmp/automaker-home/.local/bin:$PATH"\nHEALTHCHECK NONE\nENTRYPOINT ["node"]\n`,
        timeoutMs: 180000,
      });
    }
    return runDocker(rewritten, options);
  };
  const active = () => new AbortController().signal;
  beforeAll(async () => {
    expect((await runDocker(['image', 'inspect', base!])).code).toBe(0);
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'managed-docker-real-'));
    project = path.join(temporary, 'project');
    await fs.mkdir(project);
    settings = new SettingsService(path.join(temporary, 'data'));
    manager = new ManagedDocker(settings, runner);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const binding of bindings) {
      // Never remove a container without verifying the complete managed ownership/configuration.
      await manager.verify(binding);
      expect((await runDocker(['rm', '--force', binding.containerId])).code).toBe(0);
    }
    const remaining = await runDocker([
      'ps',
      '-a',
      '--filter',
      `label=dev.automaker.owner=${await manager.owner()}`,
      '--format',
      '{{.ID}}',
    ]);
    expect(remaining.stdout.trim()).toBe('');
    expect((await runDocker(['image', 'rm', tag])).code).toBe(0);
    if (volumeCreated) {
      const inspected = await runDocker(['volume', 'inspect', volume]);
      expect(JSON.parse(inspected.stdout)[0].Labels['dev.automaker.test']).toBe(tag);
      expect((await runDocker(['volume', 'rm', volume])).code).toBe(0);
    }
    await fs.rm(temporary, { recursive: true, force: true });
  });
  it('prepares lifecycle/storage, reuses a project container, and preserves files through stop/start', async () => {
    const ready = await manager.probe(undefined, project);
    expect(ready.projectStorage).toBe('verified');
    const descriptor = await manager.prepare(project, project);
    bindings.push(descriptor);
    const environment = new DockerExecutionEnvironment(manager, descriptor, project);
    await environment.writeFile('node_modules/binary', Buffer.from([0, 128, 255]), active());
    expect(await fs.readFile(path.join(project, 'node_modules/binary'))).toEqual(
      Buffer.from([0, 128, 255])
    );
    vi.stubEnv('AUTOMAKER_API_KEY', 'controller-only-test-secret');
    try {
      expect(
        (
          await environment.exec(
            'test ! -S /var/run/docker.sock && test ! -f /data/credentials.json && test -z "$AUTOMAKER_API_KEY" && printf isolated',
            active()
          )
        ).output
      ).toBe('isolated');
    } finally {
      vi.unstubAllEnvs();
    }
    await environment.writeFile('/tmp/worker-only-file', Buffer.from('worker'), active());
    expect((await runDocker(['stop', '--time', '2', descriptor.containerId])).code).toBe(0);
    const restarted = await new ManagedDocker(settings, runner).prepare(project, project);
    expect(restarted.containerId).toBe(descriptor.containerId);
    expect(
      (await environment.readFile('/tmp/worker-only-file', 0, 100, active())).data.toString()
    ).toBe('worker');
  }, 30000);
  it('shares Git/worktrees at identical paths and pins a Docker session across configuration changes', async () => {
    const descriptor = bindings[0];
    const root = new DockerExecutionEnvironment(manager, descriptor, project);
    const git = await root.exec(
      'git init -q && git -c user.name=Test -c user.email=test@example.invalid commit --allow-empty -qm init && git worktree add -qb task .worktrees/task',
      active()
    );
    expect(git.exitCode).toBe(0);
    const cwd = path.join(project, '.worktrees/task');
    const pinned = await manager.prepare(project, cwd);
    expect(pinned.containerId).toBe(descriptor.containerId);
    const worktree = new DockerExecutionEnvironment(manager, pinned, cwd);
    expect((await worktree.exec('git rev-parse --show-toplevel', active())).output.trim()).toBe(
      cwd
    );
    await settings.updateGlobalSettings({
      executionEnvironment: { default: { mode: 'auto' }, profiles: [] },
    });
    const store = new EnvironmentBindingStore(settings, manager);
    const first = await store.bind({
      cwd,
      projectPath: project,
      key: 'real-session',
      legacySettings: {},
    });
    expect(first.binding.type).toBe('docker');
    await settings.updateProjectSettings(project, { executionEnvironment: { mode: 'local' } });
    expect(
      (
        await new EnvironmentBindingStore(settings, manager).bind({
          cwd,
          projectPath: project,
          key: 'real-session',
          legacySettings: {},
        })
      ).binding
    ).toEqual(first.binding);
  }, 30000);
  it('bounds output, reports timeout effects and cancels only the selected remote process group', async () => {
    const environment = new DockerExecutionEnvironment(manager, bindings[0], project);
    expect(
      await environment.exec('printf abcdef; exit 9', active(), { maxOutputBytes: 3 })
    ).toEqual({ exitCode: 9, output: 'abc', truncated: true });
    await expect(
      environment.exec('printf x >> effects; sleep 30', active(), { timeoutMs: 100 })
    ).rejects.toMatchObject({ code: 'PROCESS_INTERRUPTED' });
    expect(await fs.readFile(path.join(project, 'effects'), 'utf8')).toBe('x');
    const controller = new AbortController();
    const request = environment.exec(
      'printf ready > started; (sleep 1; printf leaked > leaked) & wait',
      controller.signal
    );
    const assertion = expect(request).rejects.toMatchObject({ code: 'PROCESS_INTERRUPTED' });
    for (let i = 0; i < 100; i++) {
      if (
        await fs.stat(path.join(project, 'started')).then(
          () => true,
          () => false
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const other = environment.exec('sleep 0.2; printf survived', active());
    controller.abort();
    await assertion;
    expect((await other).output).toBe('survived');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await expect(fs.stat(path.join(project, 'leaked'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20000);
  it('uses real named-volume subpaths without exposing sibling projects', async () => {
    expect(
      (
        await runDocker([
          'volume',
          'create',
          '--label',
          `dev.automaker.test=${tag}`,
          '--driver',
          'local',
          '--opt',
          'type=none',
          '--opt',
          'o=bind',
          '--opt',
          `device=${temporary}`,
          volume,
        ])
      ).code
    ).toBe(0);
    volumeCreated = true;
    const volumeProject = path.join(temporary, 'volume-project');
    await fs.mkdir(volumeProject);
    vi.stubEnv('IS_CONTAINERIZED', 'true');
    vi.stubEnv('AUTOMAKER_DOCKER_CONTROLLER', 'test-controller');
    try {
      const descriptor = await manager.prepare(volumeProject, volumeProject);
      bindings.push(descriptor);
      expect(descriptor.mount).toEqual({
        type: 'volume',
        source: volume,
        subpath: 'volume-project',
      });
      const environment = new DockerExecutionEnvironment(manager, descriptor, volumeProject);
      await environment.writeFile('shared.txt', Buffer.from('same working copy'), active());
      expect(await fs.readFile(path.join(volumeProject, 'shared.txt'), 'utf8')).toBe(
        'same working copy'
      );
      await expect(
        environment.readFile(path.join(project, 'effects'), 0, 100, active())
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      vi.unstubAllEnvs();
    }
  }, 30000);
  it('runs Direct tools, real chat/restart and a pipeline command in the pinned Docker environment', async () => {
    let count = 0;
    const endpoint = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        count++;
        const tool =
          count === 1
            ? { name: 'Write', arguments: JSON.stringify({ path: 'direct.txt', content: '41' }) }
            : count === 2
              ? {
                  name: 'Bash',
                  arguments: JSON.stringify({
                    command: 'test ! -S /var/run/docker.sock && printf 42 > direct.txt',
                  }),
                }
              : count === 3
                ? { name: 'Read', arguments: JSON.stringify({ path: 'direct.txt' }) }
                : undefined;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: tool
                  ? {
                      role: 'assistant',
                      content: null,
                      tool_calls: [{ id: `tool-${count}`, type: 'function', function: tool }],
                    }
                  : { role: 'assistant', content: 'Docker workflow complete' },
                finish_reason: tool ? 'tool_calls' : 'stop',
              },
            ],
          })
        );
      });
    });
    endpoint.listen(0, '127.0.0.1');
    await once(endpoint, 'listening');
    try {
      await settings.updateProjectSettings(project, { executionEnvironment: { mode: 'auto' } });
      await settings.updateGlobalSettings({
        openaiCompatibleEndpoints: [
          {
            id: 'test',
            name: 'Test',
            enabled: true,
            baseUrl: `http://127.0.0.1:${(endpoint.address() as { port: number }).port}/v1`,
            protocol: 'chat-completions',
            auth: { type: 'credentials', credentialId: 'test' },
            models: [
              {
                id: 'Exact/Model',
                displayName: 'Model',
                capabilities: { tools: true, streaming: false },
              },
            ],
          },
        ],
      });
      await settings.updateCredentials({ openaiCompatibleApiKeys: { test: 'private-model-key' } });
      const isolated = new DockerExecutionEnvironment(manager, bindings[0], project);
      await expect(
        isolated.readFile(
          path.join(settings.getDataDirectory(), 'credentials.json'),
          0,
          100,
          active()
        )
      ).rejects.toMatchObject({ code: 'ENOENT' });
      const model = toDirectModelId('Exact/Model');
      const prepared = await prepareDirectExecution(
        { cwd: project, prompt: 'Work', model: 'Exact/Model' },
        settings,
        { model, providerId: 'test', projectPath: project, runKey: 'feature:real-direct' }
      );
      expect(prepared.executionEnvironmentBinding?.type).toBe('docker');
      const messages = [];
      for await (const message of createTestProviderRegistry(settings)
        .providerForModel(model)
        .executeQuery(prepared))
        messages.push(message);
      expect(messages.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
      expect(count).toBe(4);
      expect(await fs.readFile(path.join(project, 'direct.txt'), 'utf8')).toBe('42');
      expect(
        await runDirectShellCommand(
          settings,
          project,
          'test "$(cat direct.txt)" = 42 && printf pipeline-ok',
          active(),
          { projectPath: project, runKey: 'feature:real-direct' }
        )
      ).toMatchObject({ exitCode: 0, output: 'pipeline-ok' });

      const events = createEventEmitter();
      const streamed: Array<{ sessionId: string; type: string; content?: string }> = [];
      const unsubscribe = events.subscribe((type, payload) => {
        if (type === 'agent:stream') streamed.push(payload as (typeof streamed)[number]);
      });
      const chat = () =>
        new AgentService(
          ...createTestAgentState(settings.getDataDirectory(), createTestAgentEvents(events)),
          settings,
          ...createTestAgentProviders(createTestProviderRegistry(settings))
        );
      const service = chat();
      await service.initialize();
      const session = await service.createSession('Docker chat', project, project, model, 'test');
      count = 0;
      expect(
        (await service.sendMessage({ sessionId: session.id, message: 'Work in Docker' })).success
      ).toBe(true);
      expect(count).toBe(4);
      const chatBinding = (await service.listSessions()).find(
        (item) => item.id === session.id
      )!.executionEnvironment!;
      expect(chatBinding.type).toBe('docker');
      expect(chatBinding.docker?.containerId).toBe(bindings[0].containerId);
      await settings.updateProjectSettings(project, { executionEnvironment: { mode: 'local' } });
      try {
        const restarted = chat();
        await restarted.initialize();
        count = 0;
        expect(
          (
            await restarted.sendMessage({
              sessionId: session.id,
              message: 'Continue in pinned Docker',
            })
          ).success
        ).toBe(true);
        expect(count).toBe(4);
        expect(
          (await restarted.listSessions()).find((item) => item.id === session.id)!
            .executionEnvironment
        ).toEqual(chatBinding);
        expect(
          (await restarted.getHistory(session.id)).messages?.filter(
            (item) => item.role === 'assistant'
          )
        ).toHaveLength(2);
        expect(streamed.filter((event) => event.type === 'stream')).toEqual([
          expect.objectContaining({ sessionId: session.id, content: 'Docker workflow complete' }),
          expect.objectContaining({ sessionId: session.id, content: 'Docker workflow complete' }),
        ]);
        expect(streamed.filter((event) => event.type === 'complete')).toHaveLength(2);
        expect(await fs.readFile(path.join(project, 'direct.txt'), 'utf8')).toBe('42');
      } finally {
        unsubscribe();
        await settings.updateProjectSettings(project, { executionEnvironment: { mode: 'auto' } });
      }
    } finally {
      endpoint.closeAllConnections();
      await new Promise<void>((resolve) => endpoint.close(() => resolve()));
    }
  }, 30000);
  it('grants the target gosu user the actual socket GID without changing host permissions', async () => {
    const socket = path.join(temporary, 'controller-test.sock');
    const listener = createSocketServer();
    listener.listen(socket);
    await once(listener, 'listening');
    await fs.chmod(socket, 0o660);
    const gid = (await fs.stat(socket)).gid;
    const name = `automaker-controller-test-${randomUUID()}`;
    try {
      const entrypoint = await fs.readFile(
        path.resolve(import.meta.dirname, '../../../../docker-entrypoint.sh'),
        'utf8'
      );
      const setup = entrypoint.split('# Ensure Claude CLI config directory')[0];
      expect(setup).toContain('usermod -aG');
      const result = await runDocker([
        'run',
        '--rm',
        '--name',
        name,
        '--label',
        `dev.automaker.owner=${await manager.owner()}`,
        '--label',
        `dev.automaker.test=${tag}`,
        '--network',
        'none',
        '--user',
        '0:0',
        '--env',
        'AUTOMAKER_DOCKER_SOCKET_ACCESS=true',
        '--env',
        'AUTOMAKER_DOCKER_SOCKET_PATH=/controller-test.sock',
        '--mount',
        `type=bind,source=${socket},target=/controller-test.sock,readonly`,
        '--entrypoint',
        '/bin/sh',
        base!,
        '-c',
        setup + '\nexec gosu automaker id -G',
      ]);
      expect(result.code).toBe(0);
      expect(result.stdout.trim().split(/\s+/)).toContain(String(gid));
      expect((await fs.stat(socket)).mode & 0o777).toBe(0o660);
    } finally {
      const found = await runDocker(['container', 'inspect', name]);
      if (found.code === 0) {
        const [container] = JSON.parse(found.stdout);
        expect(container.Config.Labels['dev.automaker.test']).toBe(tag);
        expect(container.Config.Labels['dev.automaker.owner']).toBe(await manager.owner());
        expect((await runDocker(['rm', '--force', container.Id])).code).toBe(0);
      }
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  }, 15000);
  it('streams argv/stdin CLI output inside the managed container without controller environment or host tools', async () => {
    vi.stubEnv('AUTOMAKER_MOCK_AGENT', 'false');
    vi.stubEnv('AUTOMAKER_API_KEY', 'CONTROLLER_SECRET_DO_NOT_FORWARD');
    try {
      await settings.updateProjectSettings(project, { executionEnvironment: { mode: 'auto' } });
      const environment = new DockerExecutionEnvironment(manager, bindings[0], project);
      const home = (await environment.exec('printf "%s" "$HOME"', active())).output;
      expect(home.startsWith('/')).toBe(true);
      await environment.writeFile(
        path.posix.join(home, '.local/bin/cursor-agent'),
        Buffer.from(`#!/usr/bin/env node
const fs=require('node:fs');
(async()=>{
let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
if(process.env.AUTOMAKER_API_KEY||fs.existsSync('/var/run/docker.sock'))throw Error('controller authority leaked');
fs.writeFileSync('docker-cli.txt',prompt);
process.stdout.write(JSON.stringify({type:'assistant',session_id:'docker-session',message:{role:'assistant',content:[{type:'text',text:'Docker CLI complete'}]}})+'\\n');
process.stdout.write(JSON.stringify({type:'result',subtype:'success'})+'\\n');
})().catch(()=>{process.exitCode=1;});
`),
        active()
      );
      expect(
        (await environment.exec('chmod 700 "$HOME/.local/bin/cursor-agent"', active())).exitCode
      ).toBe(0);
      const prepared = await prepareDirectExecution(
        { cwd: project, prompt: 'literal $(touch cli-host-leak)', model: 'auto' },
        settings,
        { model: 'cursor-auto', projectPath: project, runKey: 'chat:docker-cli' }
      );
      expect(prepared.executionEnvironmentBinding?.type).toBe('docker');
      const messages = [];
      for await (const message of createTestProviderRegistry(settings)
        .providerForModel('cursor-auto', {
          throwOnDisconnected: false,
        })
        .executeQuery(prepared))
        messages.push(message);
      expect(messages.at(-1)).toMatchObject({ type: 'result' });
      expect(await fs.readFile(path.join(project, 'docker-cli.txt'), 'utf8')).toBe(
        'literal $(touch cli-host-leak)'
      );
      await expect(fs.stat(path.join(project, 'cli-host-leak'))).rejects.toThrow();
      let firstAt = 0;
      const started = Date.now();
      await environment.runProcess(
        {
          command: 'node',
          args: [
            '-e',
            `process.stdout.write('first');setTimeout(()=>process.stdout.write('last'),500);`,
          ],
        },
        active(),
        () => {
          firstAt ||= Date.now();
        }
      );
      expect(Date.now() - firstAt).toBeGreaterThan(300);
      expect(firstAt).toBeGreaterThan(started);
      await expect(
        environment.runProcess({ command: 'missing-automaker-cli', args: [] }, active(), () => {})
      ).rejects.toMatchObject({ code: 'PROCESS_NOT_INSTALLED' });
    } finally {
      vi.unstubAllEnvs();
    }
  }, 30000);
  it('keeps CLI Kanban, pipeline/Verify/Commit/merge and hooks in a pinned Docker feature workspace', async () => {
    const featureProject = path.join(temporary, 'feature-project');
    await fs.mkdir(featureProject);
    const descriptor = await manager.prepare(featureProject, featureProject);
    bindings.push(descriptor);
    const root = new DockerExecutionEnvironment(manager, descriptor, featureProject);
    const marker = `/tmp/feature-runtime-${randomUUID()}`;
    await root.writeFile(marker, Buffer.from('container-only'), active());
    await root.writeFile(
      '.gitignore',
      Buffer.from('.automaker/\n.worktrees/\nverified-*\n'),
      active()
    );
    await root.writeFile('AGENTS.md', Buffer.from('DOCKER_FEATURE_INSTRUCTIONS'), active());
    await root.writeFile(
      'package.json',
      Buffer.from(
        JSON.stringify({
          name: 'fixture',
          version: '1.0.0',
          scripts: Object.fromEntries(
            ['lint', 'typecheck', 'test', 'build'].map((name) => [
              name,
              `node -e "const fs=require('fs');if(!fs.existsSync('${marker}'))process.exit(97);fs.writeFileSync('verified-${name}','container')"`,
            ])
          ),
        })
      ),
      active()
    );
    expect(
      (
        await root.exec(
          'git init -qb main && git add . && git -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm base',
          active()
        )
      ).exitCode
    ).toBe(0);
    await root.writeFile(
      '.automaker/context/rules.md',
      Buffer.from('DOCKER_SHARED_CONTEXT'),
      active()
    );
    await root.writeFile(
      '.automaker/memory/architecture.md',
      Buffer.from('# Memory\n\nDocker persistent workspace bindings'),
      active()
    );
    await root.writeFile(
      '/tmp/automaker-home/.local/bin/cursor-agent',
      Buffer.from(`#!/usr/bin/env node
const fs=require('node:fs');
(async()=>{
let prompt='';for await(const data of process.stdin)prompt+=data;
if(!fs.existsSync(${JSON.stringify(marker)})||process.env.AUTOMAKER_API_KEY)throw Error('wrong environment');
fs.writeFileSync('feature-result.txt','container feature');
fs.writeFileSync('feature-invocation.json',JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),prompt}));
process.stdout.write(JSON.stringify({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Docker persistent workspace bindings implemented inside the container. '.repeat(12)}]}})+'\\n');
process.stdout.write(JSON.stringify({type:'result',subtype:'success'})+'\\n');
})().catch(()=>{process.exitCode=1;});
`),
      active()
    );
    expect((await root.exec('chmod 700 "$HOME/.local/bin/cursor-agent"', active())).exitCode).toBe(
      0
    );
    await settings.updateProjectSettings(featureProject, {
      executionEnvironment: { mode: 'auto' },
    });
    const loader = new FeatureLoader();
    const feature = await loader.create(featureProject, {
      id: 'docker-feature',
      title: 'Docker feature',
      category: 'Test',
      description: 'Implement in Docker',
      model: 'cursor-auto',
      branchName: 'main',
      status: 'ready',
      planningMode: 'skip',
      skipTests: true,
    });
    const events = createEventEmitter();
    const service = new FeatureWorkspaceService(settings);
    const facade = AutoModeServiceFacade.create(featureProject, {
      providerRegistry: createTestProviderRegistry(settings),
      events,
      settingsService: settings,
      featureLoader: loader,
    });
    const localWorktrees = vi
      .spyOn(WorktreeResolver.prototype, 'findWorktreeForBranch')
      .mockRejectedValue(new Error('controller worktree lookup forbidden'));
    vi.stubEnv('AUTOMAKER_MOCK_AGENT', 'false');
    vi.stubEnv('AUTOMAKER_API_KEY', 'controller-only');
    const hooks = new EventHookService();
    hooks.initialize(events, settings);
    try {
      await facade.executeFeature(feature.id, true, false);
      expect((await loader.get(featureProject, feature.id))!.status).toBe('waiting_approval');
      const run = (await service.prepare(featureProject, feature, active(), false))!;
      expect(run.binding).toMatchObject({
        type: 'docker',
        featureWorkspace: { baseBranch: 'main' },
      });
      expect(run.binding.docker?.containerId).toBe(descriptor.containerId);
      expect(await fs.readFile(path.join(run.environment.cwd, 'feature-result.txt'), 'utf8')).toBe(
        'container feature'
      );
      expect(
        await fs.readFile(path.join(run.environment.cwd, 'feature-invocation.json'), 'utf8')
      ).toContain('DOCKER_SHARED_CONTEXT');
      await expect(fs.stat(path.join(featureProject, 'feature-result.txt'))).rejects.toThrow();
      expect(localWorktrees).not.toHaveBeenCalled();
      expect(
        parseFrontmatter(
          await fs.readFile(
            path.join(featureProject, '.automaker', 'memory', 'architecture.md'),
            'utf8'
          )
        ).metadata.usageStats
      ).toEqual({ loaded: 1, referenced: 1, successfulFeatures: 0 });
      const hostRunner = { startTests: vi.fn() };
      const pipeline = new PipelineOrchestrator(
        new TypedEventBus(events),
        {} as never,
        {} as never,
        hostRunner as never,
        new WorktreeResolver(settings),
        {} as never,
        settings,
        vi.fn(),
        vi.fn(),
        vi.fn(),
        vi.fn(),
        vi.fn()
      );
      expect(
        await pipeline.executeTestStep(
          {
            projectPath: featureProject,
            featureId: feature.id,
            feature,
            steps: [],
            workDir: featureProject,
            worktreePath: null,
            branchName: 'main',
            abortController: new AbortController(),
            autoLoadClaudeMd: false,
            testAttempts: 0,
            maxTestAttempts: 1,
          },
          'npm test'
        )
      ).toMatchObject({ success: true, testsPassed: true });
      expect(hostRunner.startTests).not.toHaveBeenCalled();
      expect(await facade.verifyFeature(feature.id)).toBe(true);
      for (const name of ['lint', 'typecheck', 'test', 'build'])
        expect(await fs.readFile(path.join(run.environment.cwd, `verified-${name}`), 'utf8')).toBe(
          'container'
        );
      const hook = (id?: string) =>
        (
          hooks as unknown as {
            executeShellHook(action: object, context: object, name: string): Promise<void>;
          }
        ).executeShellHook(
          {
            type: 'shell',
            command: `test -f ${marker} && printf hook > "{{projectPath}}/hook-result"`,
          },
          {
            projectPath: featureProject,
            featureId: id,
            eventType: 'feature_success',
            timestamp: new Date().toISOString(),
          },
          'fixture'
        );
      await hook(feature.id);
      expect(await fs.readFile(path.join(run.environment.cwd, 'hook-result'), 'utf8')).toBe('hook');
      await expect(hook()).rejects.toThrow('Unbound/project-wide');
      const second = (await service.prepare(
        featureProject,
        { ...feature, id: 'parallel' },
        active()
      ))!;
      expect(second.environment.cwd).not.toBe(run.environment.cwd);
      await expect(
        fs.stat(path.join(second.environment.cwd, 'feature-result.txt'))
      ).rejects.toThrow();
      await settings.updateProjectSettings(featureProject, {
        executionEnvironment: { mode: 'local' },
      });
      expect(
        (await new FeatureWorkspaceService(settings).prepare(
          featureProject,
          feature,
          active(),
          false
        ))!.binding
      ).toEqual(run.binding);
      await expect(
        service.prepare(featureProject, { ...feature, branchName: 'other' }, active())
      ).rejects.toThrow('workspace');
      const commit = await facade.commitFeature(feature.id);
      expect(commit).toMatch(/^[a-f0-9]{40,64}$/);
      await facade.mergeEnvironmentFeature(feature.id);
      expect(await fs.readFile(path.join(featureProject, 'feature-result.txt'), 'utf8')).toBe(
        'container feature'
      );
      expect(await facade.commitFeature(feature.id)).toBeNull();
      // Pre-5.3 Docker bindings must never be silently moved into the new worktree.
      await settings.updateProjectSettings(featureProject, {
        executionEnvironment: { mode: 'auto' },
      });
      await new EnvironmentBindingStore(settings, manager).bind({
        projectPath: featureProject,
        cwd: featureProject,
        key: `feature:${featureProject}:old-docker`,
        legacySettings: {},
      });
      await expect(
        service.prepare(featureProject, { ...feature, id: 'old-docker' }, active())
      ).rejects.toThrow('legacy managed workspace');

      let calls = 0;
      const endpoint = createServer((req, res) => {
        req.resume();
        req.on('end', () => {
          calls++;
          const tool =
            calls === 1
              ? {
                  name: 'Write',
                  arguments: JSON.stringify({
                    path: 'direct-feature.txt',
                    content: 'container direct',
                  }),
                }
              : calls === 2
                ? {
                    name: 'Bash',
                    arguments: JSON.stringify({ command: `test -f ${marker} && npm test` }),
                  }
                : null;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              choices: [
                {
                  index: 0,
                  message: tool
                    ? {
                        role: 'assistant',
                        content: null,
                        tool_calls: [
                          { id: `feature-call-${calls}`, type: 'function', function: tool },
                        ],
                      }
                    : { role: 'assistant', content: 'Direct container feature completed' },
                  finish_reason: tool ? 'tool_calls' : 'stop',
                },
              ],
            })
          );
        });
      });
      endpoint.listen(0, '127.0.0.1');
      await once(endpoint, 'listening');
      try {
        await settings.updateGlobalSettings({
          openaiCompatibleEndpoints: [
            {
              id: 'feature-endpoint',
              name: 'Fixture',
              enabled: true,
              baseUrl: `http://127.0.0.1:${(endpoint.address() as { port: number }).port}/v1`,
              protocol: 'chat-completions',
              auth: { type: 'none' },
              models: [
                {
                  id: 'docker-feature-model',
                  displayName: 'Fixture',
                  capabilities: { tools: true, streaming: false },
                },
              ],
            },
          ],
        });
        const model = toDirectModelId('docker-feature-model');
        const directFeature = { id: 'direct-feature', model, branchName: 'main' };
        const run = (await service.prepare(featureProject, directFeature, active()))!;
        const options = await prepareDirectExecution(
          {
            cwd: featureProject,
            prompt: 'Implement with target tools',
            model: 'docker-feature-model',
          },
          settings,
          {
            model,
            providerId: 'feature-endpoint',
            projectPath: featureProject,
            runKey: `feature:${featureProject}:${directFeature.id}`,
            feature: { targetBranch: 'main' },
          }
        );
        expect(options.cwd).toBe(run.environment.cwd);
        const messages = [];
        for await (const message of createTestProviderRegistry(settings)
          .providerForModel(model)
          .executeQuery(options))
          messages.push(message);
        expect(messages.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
        expect(calls).toBe(3);
        expect(
          await fs.readFile(path.join(run.environment.cwd, 'direct-feature.txt'), 'utf8')
        ).toBe('container direct');
        expect(await fs.readFile(path.join(run.environment.cwd, 'verified-test'), 'utf8')).toBe(
          'container'
        );
        await expect(fs.stat(path.join(featureProject, 'direct-feature.txt'))).rejects.toThrow();
      } finally {
        endpoint.closeAllConnections();
        await new Promise<void>((resolve) => endpoint.close(() => resolve()));
      }
    } finally {
      hooks.destroy();
      localWorktrees.mockRestore();
      vi.unstubAllEnvs();
    }
  }, 90000);
  it('runs all three target-side SDK adapters inside a managed container with fixture packages and separate target keys', async () => {
    const fixtureHome = path.join(temporary, 'fixture-home');
    await sdkInstallerFixture(fixtureHome);
    const sdkProject = path.join(temporary, 'sdk-project');
    await fs.mkdir(sdkProject);
    const descriptor = await manager.prepare(sdkProject, sdkProject);
    bindings.push(descriptor);
    const environment = new DockerExecutionEnvironment(manager, descriptor, sdkProject);
    await environment.writeFile('.gitignore', Buffer.from('.automaker/\n.worktrees/\n'), active());
    expect(
      (
        await environment.exec(
          'git init -qb main && git add . && git -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm base',
          active()
        )
      ).exitCode
    ).toBe(0);
    const home = (await environment.exec('printf "%s" "$HOME"', active())).output;
    await environment.writeFile(
      path.join(home, '.fixture-sdk.mjs'),
      await fs.readFile(path.join(fixtureHome, '.fixture-sdk.mjs')),
      active()
    );
    await environment.writeFile(
      path.join(home, '.local/bin/npm'),
      await fs.readFile(path.join(fixtureHome, '.local/bin/npm')),
      active()
    );
    expect((await environment.exec('chmod 700 "$HOME/.local/bin/npm"', active())).exitCode).toBe(0);
    await settings.updateProjectSettings(sdkProject, { executionEnvironment: { mode: 'auto' } });
    const setup = new ProviderSetupService(settings, manager);
    vi.stubEnv('AUTOMAKER_MOCK_AGENT', 'false');
    vi.stubEnv('AUTOMAKER_API_KEY', 'controller-only');
    try {
      for (const [provider, model] of [
        ['claude', 'sonnet'],
        ['codex', 'codex-gpt-5'],
        ['copilot', 'copilot-gpt-5'],
      ] as const) {
        const status = await setup.run(sdkProject, provider, 'inspect', active());
        await setup.run(sdkProject, provider, 'install', active(), { targetId: status.targetId });
        await setup.run(sdkProject, provider, 'key', active(), {
          targetId: status.targetId,
          apiKey: 'target-fixture-key',
        });
        const options = await prepareDirectExecution(
          { cwd: sdkProject, prompt: 'Docker SDK execution', model: stripProviderPrefix(model) },
          settings,
          { model, projectPath: sdkProject, runKey: `chat:${provider}:docker` }
        );
        const messages = [];
        for await (const message of createTestProviderRegistry(settings)
          .providerForModel(model, {
            throwOnDisconnected: false,
          })
          .executeQuery(options))
          messages.push(message);
        expect(messages.at(-1)).toMatchObject({
          type: 'result',
          session_id: `${provider}-session`,
        });
        expect(await fs.readFile(path.join(sdkProject, 'sdk-result.txt'), 'utf8')).toBe(
          'remote-only'
        );
        const feature = { id: `sdk-${provider}`, model, branchName: 'main' };
        const run = (await new FeatureWorkspaceService(settings).prepare(
          sdkProject,
          feature,
          active()
        ))!;
        const featureOptions = await prepareDirectExecution(
          { cwd: sdkProject, prompt: 'Docker SDK feature', model: stripProviderPrefix(model) },
          settings,
          {
            model,
            projectPath: sdkProject,
            runKey: `feature:${sdkProject}:${feature.id}`,
            feature: { targetBranch: 'main' },
          }
        );
        expect(featureOptions.cwd).toBe(run.environment.cwd);
        for await (const _message of createTestProviderRegistry(settings)
          .providerForModel(model, {
            throwOnDisconnected: false,
          })
          .executeQuery(featureOptions)) {
          /* drain */
        }
        expect(await fs.readFile(path.join(run.environment.cwd, 'sdk-result.txt'), 'utf8')).toBe(
          'remote-only'
        );
      }
    } finally {
      vi.unstubAllEnvs();
    }
  }, 60000);
  it('runs general Git UI reads/stage/commit/create in Docker and keeps pinned worktrees after defaults change', async () => {
    const gitProject = path.join(temporary, 'git-ui-project');
    await fs.mkdir(gitProject);
    const descriptor = await manager.prepare(gitProject, gitProject);
    bindings.push(descriptor);
    const runtime = new DockerExecutionEnvironment(manager, descriptor, gitProject);
    await runtime.writeFile('.gitignore', Buffer.from('.automaker/\n.worktrees/\n'), active());
    await runtime.writeFile('source.txt', Buffer.from('base\n'), active());
    expect(
      (
        await runtime.exec(
          'git init -qb main && git add . && git -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm base',
          active()
        )
      ).exitCode
    ).toBe(0);
    await settings.updateProjectSettings(gitProject, { executionEnvironment: { mode: 'auto' } });
    const service = new ProjectGitService(settings, manager);
    const runner = vi.spyOn(manager, 'runner');
    const target = (await service.resolve(gitProject))!;
    expect(target.environment.type).toBe('docker');
    expect(runner).not.toHaveBeenCalled();
    runner.mockRestore();
    await runtime.writeFile('source.txt', Buffer.from('changed in container\n'), active());
    const diff = await service.run(target, 'diffs', {}, active());
    expect(diff.diff).toContain('+changed in container');
    await expect(
      service.run(target, 'commit', { message: 'No target approval' }, active())
    ).rejects.toMatchObject({ code: 'GIT_TARGET_CHANGED' });
    await expect(service.run(target, 'push', {}, active())).rejects.toMatchObject({
      code: 'GIT_TARGET_CHANGED',
    });
    const token = { environmentTargetId: target.environment.targetId };
    expect(
      await service.run(
        target,
        'stage-files',
        { ...token, operation: 'stage', files: ['source.txt'] },
        active()
      )
    ).toMatchObject({ success: true, result: { filesCount: 1 } });
    expect(
      await service.run(
        target,
        'commit',
        { ...token, message: 'Container Git UI commit' },
        active()
      )
    ).toMatchObject({ success: true, result: { committed: true } });
    expect(await service.run(target, 'commit-log', {}, active())).toMatchObject({
      result: {
        commits: expect.arrayContaining([
          expect.objectContaining({ subject: 'Container Git UI commit' }),
        ]),
      },
    });
    const created = await service.run(
      target,
      'create',
      { ...token, branchName: 'ui-task', baseBranch: 'main' },
      active()
    );
    const pathOnController = (created.worktree as { path: string }).path;
    expect(pathOnController).toContain(gitProject + '/.worktrees/');
    const list = await service.run(target, 'list', {}, active());
    const child = (
      list.worktrees as Array<{ path: string; executionEnvironment: { targetId: string } }>
    ).find((item) => item.path === pathOnController)!;
    expect((await service.resolve(pathOnController))!.environment.targetId).toBe(
      child.executionEnvironment.targetId
    );
    const feature = { id: 'git-ui-pinned', model: 'cursor-auto', branchName: 'main' };
    const run = (await new FeatureWorkspaceService(settings).prepare(
      gitProject,
      feature,
      active()
    ))!;
    await run.environment.writeFile('pinned.txt', Buffer.from('Docker pin'), active());
    await settings.updateProjectSettings(gitProject, { executionEnvironment: { mode: 'local' } });
    const pinned = (await service.resolve(gitProject, feature.id))!;
    expect(pinned.environment).toMatchObject({ type: 'docker', pinned: true });
    expect((await service.run(pinned, 'diffs', {}, active())).diff).toContain('Docker pin');
  }, 60000);
  it('shares project memory across pinned Docker feature worktrees and preserves it through restart/default changes', async () => {
    const memoryProject = path.join(temporary, 'memory-project');
    await fs.mkdir(memoryProject);
    await settings.updateProjectSettings(memoryProject, { executionEnvironment: { mode: 'auto' } });
    const descriptor = await manager.prepare(memoryProject, memoryProject);
    bindings.push(descriptor);
    const root = new DockerExecutionEnvironment(manager, descriptor, memoryProject);
    expect(
      (
        await root.exec(
          "git init -qb main && printf '.automaker/\\n.worktrees/\\n' > .gitignore && git add . && git -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm base",
          active()
        )
      ).exitCode
    ).toBe(0);
    const service = new FeatureWorkspaceService(settings);
    const feature = { id: 'memory-feature', model: 'cursor-auto', branchName: 'main' };
    const first = (await service.prepare(memoryProject, feature, active()))!;
    const second = (await service.prepare(
      memoryProject,
      { ...feature, id: 'memory-second' },
      active()
    ))!;
    const learning = {
      category: 'Architecture',
      type: 'pattern' as const,
      content: 'Container immutable workspace bindings',
    };
    await service.memory(first).appendLearning(learning, active());
    const firstContext = await service.context(first, active());
    const secondContext = await service.context(second, active());
    expect(firstContext.memoryFiles[0].path).toBe(
      path.join(memoryProject, '.automaker', 'memory', 'architecture.md')
    );
    expect(secondContext.formattedPrompt).toContain(learning.content);
    await Promise.all([
      service.memory(first).recordUsage(firstContext.memoryFiles, learning.content, true, active()),
      service
        .memory(second)
        .recordUsage(secondContext.memoryFiles, learning.content, false, active()),
    ]);
    await settings.updateProjectSettings(memoryProject, {
      executionEnvironment: { mode: 'local' },
    });
    expect((await runDocker(['stop', '--time', '2', descriptor.containerId])).code).toBe(0);
    const restarted = new FeatureWorkspaceService(settings);
    const pinned = (await restarted.prepare(memoryProject, feature, active(), false))!;
    expect(pinned.binding).toEqual(first.binding);
    await restarted
      .memory(pinned)
      .appendLearning({ ...learning, content: 'Retained Docker target' }, active());
    const raw = (
      await pinned.environment.readFile(firstContext.memoryFiles[0].path, 0, 32768, active())
    ).data.toString();
    expect(parseFrontmatter(raw).metadata.usageStats).toEqual({
      loaded: 2,
      referenced: 2,
      successfulFeatures: 1,
    });
    expect(raw).toContain('Retained Docker target');
    await expect(
      fs.stat(path.join(first.environment.cwd, '.automaker', 'memory'))
    ).rejects.toThrow();
  }, 60000);
  it.skipIf(process.env.MANAGED_TERMINAL_TEST !== 'true')(
    'runs a real interactive Docker PTY with input/resize and confirmed session-job cleanup',
    async () => {
      await settings.updateProjectSettings(project, { executionEnvironment: { mode: 'auto' } });
      const target = (await new ProjectGitService(settings).resolve(project))!;
      const terminal = await ManagedTerminalPty.open(target, settings, { cols: 80, rows: 24 });
      let output = '';
      let exitCode: number | undefined;
      terminal.pty.onData((data) => {
        output += data;
      });
      terminal.pty.onExit((event) => {
        exitCode = event.exitCode;
      });
      try {
        terminal.pty.resize(122, 38);
        terminal.pty.write(
          "test -t 0 && printf 'DOCKER_PTY_OK\\n'; stty size; sleep 60 & echo $! > terminal-background.pid\n"
        );
        await vi.waitFor(
          () => {
            expect(output).toContain('DOCKER_PTY_OK\r\n');
            expect(output).toContain('38 122');
          },
          { timeout: 5000 }
        );
        await vi.waitFor(async () =>
          expect(await fs.readFile(path.join(project, 'terminal-background.pid'), 'utf8')).toMatch(
            /\d+/
          )
        );
        await settings.updateProjectSettings(project, { executionEnvironment: { mode: 'local' } });
        terminal.pty.write('printf retained > terminal-result.txt\n');
        await vi.waitFor(async () =>
          expect(await fs.readFile(path.join(project, 'terminal-result.txt'), 'utf8')).toBe(
            'retained'
          )
        );
        terminal.pty.kill();
        await vi.waitFor(() => expect(exitCode).toBe(-9), { timeout: 5000 });
        const env = new DockerExecutionEnvironment(manager, bindings[0], project);
        const result = await env.exec(
          'p=$(cat terminal-background.pid); test ! -e /proc/$p/stat',
          active()
        );
        expect(result.exitCode).toBe(0);
      } finally {
        terminal.pty.kill();
      }
    },
    20000
  );
  it.skipIf(process.env.MANAGED_TERMINAL_TEST !== 'true')(
    'runs manual tests in the pinned Docker container and confirms stop without changing its ports',
    async () => {
      await settings.updateProjectSettings(project, {
        executionEnvironment: { mode: 'auto' },
        testCommand:
          "printf 'DOCKER_TEST\\n'; echo once >> manual-effects; sleep 60 & echo $! > manual-child.pid; wait",
      });
      const target = (await new ProjectGitService(settings).resolve(project))!;
      const service = new ManagedTestRunnerService(settings, createEventEmitter());
      try {
        const session = await service.start(target, target.environment.targetId, undefined);
        await vi.waitFor(() =>
          expect(service.find(undefined, session.sessionId)?.logs).toContain('DOCKER_TEST')
        );
        await vi.waitFor(() => fs.access(path.join(project, 'manual-child.pid')));
        await settings.updateProjectSettings(project, { executionEnvironment: { mode: 'local' } });
        expect((await service.stop(session.sessionId)).sessionId).toBe(session.sessionId);
        expect(service.find(project)?.status).toBe('cancelled');
        expect(service.find(project)?.executionEnvironment.type).toBe('docker');
        const env = new DockerExecutionEnvironment(manager, bindings[0], project);
        expect(
          (await env.exec('p=$(cat manual-child.pid); test ! -e /proc/$p/stat', active())).exitCode
        ).toBe(0);
        expect(await fs.readFile(path.join(project, 'manual-effects'), 'utf8')).toBe('once\n');
        const inspection = await runDocker([
          'inspect',
          bindings[0].containerId,
          '--format',
          '{{json .HostConfig.PortBindings}}',
        ]);
        expect([null, {}]).toContainEqual(JSON.parse(inspection.stdout));
        await settings.updateProjectSettings(project, {
          executionEnvironment: { mode: 'auto' },
          testCommand: "printf 'FINAL_TEST_TAIL\\n'; exit 7",
        });
        const failed = await service.start(target, target.environment.targetId, undefined);
        await vi.waitFor(() =>
          expect(service.find(undefined, failed.sessionId)?.status).toBe('failed')
        );
        expect(service.find(undefined, failed.sessionId)?.exitCode).toBe(7);
        expect(service.find(undefined, failed.sessionId)?.logs).toContain('FINAL_TEST_TAIL');
      } finally {
        await service.cleanup();
      }
    },
    30000
  );
  it.skipIf(process.env.MANAGED_TERMINAL_TEST !== 'true')(
    'previews an owned Docker dev listener without publishing ports or recreating its pinned container',
    async () => {
      await settings.updateProjectSettings(project, {
        executionEnvironment: { mode: 'auto' },
        devCommand: 'node preview-app.cjs',
      });
      const target = (await new ProjectGitService(settings).resolve(project))!;
      await target.runtime.writeFile(
        'preview-app.cjs',
        Buffer.from(
          "require('node:fs').writeFileSync('preview-app.pid',String(process.pid));require('node:http').createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end(JSON.stringify({cwd:process.cwd(),key:process.env.AUTOMAKER_API_KEY,cookie:q.headers.cookie}));}).listen(Number(process.env.PORT),'127.0.0.1');"
        ),
        active()
      );
      const dev = new ManagedDevServerService(settings, createEventEmitter());
      try {
        const started = await dev.start(target, target.environment.targetId);
        await vi.waitFor(() => expect(dev.find(undefined, started.sessionId)?.ready).toBe(true), {
          timeout: 15000,
        });
        const response = await fetch(`http://127.0.0.1:${started.port}/`, {
          headers: {
            Cookie: `automaker_preview_${started.port}=${new URL(started.url).hash.slice(1)}; automaker_session=CONTROLLER_SECRET`,
          },
        });
        const body = await response.json();
        expect(body.cwd).toBe(project);
        expect(body.cookie).toBeUndefined();
        expect(body.key ?? '').toBe('');
        const inspected = await runDocker([
          'inspect',
          bindings[0].containerId,
          '--format',
          '{{json .HostConfig.PortBindings}}',
        ]);
        expect([null, {}]).toContainEqual(JSON.parse(inspected.stdout));
        await settings.updateProjectSettings(project, { executionEnvironment: { mode: 'local' } });
        await dev.stop(started.sessionId);
        const env = new DockerExecutionEnvironment(manager, bindings[0], project);
        expect(
          (await env.exec('p=$(cat preview-app.pid); test ! -e /proc/$p/stat', active())).exitCode
        ).toBe(0);
      } finally {
        await dev.cleanup();
      }
    },
    30000
  );
  it.skipIf(process.env.MANAGED_PROVIDER_INSTALL_TEST !== 'true')(
    'installs the pinned SDKs using real target npm and verifies bundled CLI versions, without model calls',
    async () => {
      await settings.updateProjectSettings(project, { executionEnvironment: { mode: 'auto' } });
      const setup = new ProviderSetupService(settings, manager);
      const environment = new DockerExecutionEnvironment(manager, bindings[0], project);
      for (const provider of ['claude', 'codex', 'copilot'] as const) {
        const initial = await setup.run(project, provider, 'inspect', active());
        const installed = await setup.run(project, provider, 'install', active(), {
          targetId: initial.targetId,
        });
        expect(installed.installed).toBe(true);
        expect(installed.environment).toBe('docker');
        const manifest = providerManifest(provider);
        const result = await environment.runProcess(
          {
            command: 'node',
            args: [
              '-e',
              String.raw`
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const [root,provider,sdk]=process.argv.slice(1),directory=path.join(root,'node_modules',sdk);
const executable=provider==='codex'?path.join(directory,'vendor',process.arch==='x64'?'x86_64-unknown-linux-musl':'aarch64-unknown-linux-musl','codex/codex'):process.execPath;
const args=provider==='codex'?['--version']:[provider==='claude'?path.join(directory,'cli.js'):path.join(root,'node_modules/@github/copilot/npm-loader.js'),'--version'];
execFileSync(executable,args,{stdio:'pipe',timeout:30000});
if(!fs.existsSync(path.join(root,'package-lock.json')))process.exit(3);
`,
              installed.root,
              provider,
              manifest.sdk,
            ],
          },
          active(),
          () => {}
        );
        expect(result.exitCode).toBe(0);
        const credentialed = await setup.run(project, provider, 'key', active(), {
          targetId: installed.targetId,
          apiKey: 'fixture-token-not-a-real-provider-key',
        });
        expect(credentialed).toMatchObject({
          hasStoredKey: true,
          authentication: 'configured-unverified',
        });
        await setup.run(project, provider, 'key', active(), {
          targetId: installed.targetId,
          clear: true,
        });
      }
    },
    300000
  );
});
