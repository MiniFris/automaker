import * as executionFilesystem from '../../../src/lib/secure-fs.js';
import { PipelineService } from '../../../src/services/pipeline-service.js';
const pipelineService = new PipelineService();
import { NtfyService } from '../../../src/services/ntfy-service.js';
import { createTestProviderRegistry } from '../../helpers/provider-registry.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { toDirectModelId, type Feature, type SSHEnvironmentProfile } from '@automaker/types';
import { parseFrontmatter } from '@automaker/utils';
import { SettingsService } from '@/services/settings-service.js';
import { ManagedSSH } from '@/services/execution-environment/ssh.js';
import { SSHFeatureService, featureRunKey } from '@/services/execution-environment/ssh-feature.js';
import { EnvironmentBindingStore } from '@/services/execution-environment/bindings.js';
import { WorktreeResolver } from '@/services/worktree-resolver.js';
import { AutoModeServiceFacade } from '@/services/auto-mode/facade.js';
import { FeatureLoader } from '@/services/feature-loader.js';

import { createEventEmitter } from '@/lib/events.js';
import { EventHookService } from '@/services/event-hook-service.js';
import { ApplicationEventBusAdapter } from '@/core/eventing/application-event-bus.adapter.js';
import { PipelineOrchestrator } from '@/services/pipeline-orchestrator.js';
import { TypedEventBus } from '@/services/typed-event-bus.js';
import { sshPeer, testSSHKey } from '../../helpers/ssh-peer.js';

const execute = promisify(execFile);
const active = () => new AbortController().signal;
describe.skipIf(process.platform !== 'linux')(
  'Direct SSH feature workflow on a real SSH/Git peer',
  () => {
    let temporary: string,
      project: string,
      checkout: string,
      settings: SettingsService,
      manager: ManagedSSH,
      service: SSHFeatureService,
      peer: Awaited<ReturnType<typeof sshPeer>>,
      profile: SSHEnvironmentProfile,
      feature: Feature,
      loader: FeatureLoader;
    let modelServer: ReturnType<typeof createServer>;
    const model = toDirectModelId('feature-model');
    let bodies: Array<{
      tools?: Array<{ function: { name: string } }>;
      messages: Array<{ role: string; content: unknown }>;
    }>;
    let respond: (response: ServerResponse) => void;
    const git = (...args: string[]) =>
      execute('git', ['-C', checkout, ...args]).then((r) => r.stdout.trim());
    const finish = (
      response: ServerResponse,
      text = 'Implementation completed remotely. '.repeat(12)
    ) =>
      response.end(
        JSON.stringify({
          choices: [
            { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
          ],
        })
      );
    const call = (response: ServerResponse, name: string, args: object) =>
      response.end(
        JSON.stringify({
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: `call-${bodies.length}`,
                    type: 'function',
                    function: { name, arguments: JSON.stringify(args) },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        })
      );
    beforeEach(async () => {
      vi.stubEnv('AUTOMAKER_MOCK_AGENT', 'false');
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-feature-test-'));
      project = path.join(temporary, 'controller');
      checkout = path.join(temporary, "remote checkout 'quoted");
      await fs.mkdir(project);
      await fs.mkdir(checkout);
      const key = testSSHKey();
      peer = await sshPeer(path.join(temporary, 'remote'), key);
      profile = {
        id: 'ssh',
        name: 'SSH',
        type: 'ssh',
        host: '127.0.0.1',
        port: peer.port,
        username: 'developer',
        basePath: path.join(temporary, 'remote', 'base'),
        credentialId: 'key',
      };
      await git('init', '-q', '-b', 'main');
      await git('config', 'user.name', 'Fixture');
      await git('config', 'user.email', 'fixture@example.invalid');
      await fs.writeFile(path.join(checkout, 'AGENTS.md'), 'REMOTE_BRANCH_INSTRUCTIONS');
      await fs.writeFile(
        path.join(checkout, '.gitignore'),
        '.automaker/\n.worktrees/\nverified-*\n'
      );
      await fs.writeFile(path.join(checkout, 'source.txt'), 'base');
      const scripts = Object.fromEntries(
        ['lint', 'typecheck', 'test', 'build'].map((name) => [
          name,
          `node -e "require('fs').writeFileSync('verified-${name}', 'remote')"`,
        ])
      );
      await fs.writeFile(
        path.join(checkout, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '1.0.0', scripts })
      );
      await git('add', '.');
      await git('commit', '-qm', 'base');
      settings = new SettingsService(path.join(temporary, 'data'));
      manager = new ManagedSSH(settings);
      service = new SSHFeatureService(settings, manager);
      await settings.updateGlobalSettings({
        executionEnvironment: {
          default: { mode: 'profile', profileId: 'ssh' },
          profiles: [profile],
        },
      });
      const host = await manager.state.scan(profile);
      await manager.state.confirm(profile, host.fingerprint, false);
      await manager.state.saveKey('key', key);
      await manager.prepareProject(
        profile,
        project,
        { method: 'existing', remotePath: checkout },
        active()
      );
      await fs.mkdir(path.join(checkout, '.automaker', 'context'), { recursive: true });
      await fs.writeFile(
        path.join(checkout, '.automaker', 'context', 'rules.md'),
        'REMOTE_SHARED_RULES'
      );
      await fs.mkdir(path.join(project, '.automaker', 'context'), { recursive: true });
      await fs.writeFile(
        path.join(project, '.automaker', 'context', 'rules.md'),
        'STALE_CONTROLLER_SOURCE_RULES'
      );
      await fs.writeFile(
        path.join(project, 'package.json'),
        JSON.stringify({ scripts: { test: 'printf host-leak > leaked' } })
      );
      feature = {
        id: 'feature',
        category: 'Test',
        title: 'Remote feature',
        description: 'Implement remotely',
        model,
        providerId: 'model',
        branchName: 'main',
        status: 'ready',
        planningMode: 'skip',
        skipTests: true,
      };
      loader = new FeatureLoader();
      await loader.create(project, feature);
      bodies = [];
      respond = (response) => finish(response);
      modelServer = createServer((request, response) => {
        void (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          bodies.push(JSON.parse(Buffer.concat(chunks).toString()));
          response.setHeader('Content-Type', 'application/json');
          respond(response);
        })().catch(() => {
          response.statusCode = 500;
          response.end();
        });
      });
      modelServer.listen(0, '127.0.0.1');
      await once(modelServer, 'listening');
      await settings.updateGlobalSettings({
        openaiCompatibleEndpoints: [
          {
            id: 'model',
            name: 'Model',
            baseUrl: `http://127.0.0.1:${(modelServer.address() as { port: number }).port}/v1`,
            enabled: true,
            protocol: 'chat-completions',
            auth: { type: 'none' },
            models: [
              {
                id: 'feature-model',
                displayName: 'Feature',
                capabilities: { tools: true, streaming: false },
              },
            ],
          },
        ],
      });
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      modelServer?.closeAllConnections();
      if (modelServer) await new Promise<void>((resolve) => modelServer.close(() => resolve()));
      await peer?.close();
      await fs.rm(temporary, { recursive: true, force: true });
    });
    it(
      'pins branch/base intent and isolates simultaneous feature source without a controller Git repository',
      { timeout: 20000 },
      async () => {
        const first = (await service.prepare(project, feature, active()))!;
        const second = (await service.prepare(project, { ...feature, id: 'second' }, active()))!;
        expect(first.binding.sshWorkspace).toMatchObject({
          baseBranch: 'main',
          baseCommit: await git('rev-parse', 'main'),
        });
        expect(first.environment.cwd).not.toBe(second.environment.cwd);
        await first.environment.writeFile('source.txt', Buffer.from('first'), active());
        expect(
          (await second.environment.readFile('source.txt', 0, 100, active())).data.toString()
        ).toBe('base');
        await expect(fs.stat(path.join(project, '.git'))).rejects.toThrow();
        expect(await git('show', 'main:source.txt')).toBe('base');
      }
    );
    it(
      'loads only bounded remote context and resolves the AutoMode primary branch remotely',
      { timeout: 20000 },
      async () => {
        const run = (await service.prepare(project, feature, active()))!;
        const context = await service.context(run, active());
        expect(context.formattedPrompt).toContain('REMOTE_BRANCH_INSTRUCTIONS');
        expect(context.formattedPrompt).toContain('REMOTE_SHARED_RULES');
        expect(context.formattedPrompt).not.toContain('STALE_CONTROLLER_SOURCE_RULES');
        expect(await new WorktreeResolver(settings).getCurrentBranch(project)).toBe('main');
        await fs.writeFile(
          path.join(checkout, '.automaker', 'context', 'huge.md'),
          'x'.repeat(32769)
        );
        await expect(service.context(run, active())).rejects.toMatchObject({
          code: 'SSH_CONTEXT_BUDGET',
        });
      }
    );
    it(
      'writes shared memory through SSH, retaining its project root across feature worktrees and default changes',
      { timeout: 35000 },
      async () => {
        const run = (await service.prepare(project, feature, active()))!;
        const memory = service.memory(run);
        const controllerFile = path.join(project, '.automaker', 'memory', 'architecture.md');
        await fs.mkdir(path.dirname(controllerFile), { recursive: true });
        await fs.writeFile(controllerFile, 'STALE_CONTROLLER_MEMORY');
        const learning = {
          category: 'Architecture',
          type: 'decision' as const,
          content: 'Remote immutable workspace bindings',
          why: 'Do not mix controller files with remote state',
        };
        await memory.writer(active()).appendLearning(learning);
        const context = await service.context(run, active());
        expect(context.memoryFiles).toEqual([
          expect.objectContaining({
            name: 'architecture.md',
            path: path.join(checkout, '.automaker', 'memory', 'architecture.md'),
          }),
        ]);
        expect(context.formattedPrompt).toContain(learning.content);
        expect(context.formattedPrompt).not.toContain('STALE_CONTROLLER_MEMORY');
        expect(context.files.map((file) => file.name)).not.toContain('architecture.md');
        await settings.updateGlobalSettings({
          executionEnvironment: { default: { mode: 'local' }, profiles: [] },
        });
        const restarted = new SSHFeatureService(settings);
        const pinned = (await restarted.prepare(project, feature, active(), false))!;
        await restarted
          .memory(pinned)
          .recordUsage(context.memoryFiles, learning.content, true, active());
        const targetFile = path.join(checkout, '.automaker', 'memory', 'architecture.md');
        expect(parseFrontmatter(await fs.readFile(targetFile, 'utf8')).metadata.usageStats).toEqual(
          {
            loaded: 1,
            referenced: 1,
            successfulFeatures: 1,
          }
        );
        expect(await fs.readFile(controllerFile, 'utf8')).toBe('STALE_CONTROLLER_MEMORY');
        await expect(
          fs.stat(path.join(run.environment.cwd, '.automaker', 'memory'))
        ).rejects.toThrow();
        await manager.state.removeKey('key');
        await expect(restarted.memory(pinned).appendLearning(learning, active())).rejects.toThrow();
        expect(await fs.readFile(controllerFile, 'utf8')).toBe('STALE_CONTROLLER_MEMORY');
      }
    );
    it(
      'retains its target after restart/default changes and refuses branch retargeting or a changed checkout',
      { timeout: 20000 },
      async () => {
        const run = (await service.prepare(project, feature, active()))!;
        await settings.updateGlobalSettings({
          executionEnvironment: { default: { mode: 'local' }, profiles: [] },
        });
        const restarted = new SSHFeatureService(settings);
        expect((await restarted.prepare(project, feature, active()))!.binding).toEqual(run.binding);
        await expect(
          restarted.prepare(project, { ...feature, branchName: 'other' }, active())
        ).rejects.toThrow('branch');
        await run.environment.exec('git checkout -b changed', active());
        await expect(restarted.prepare(project, feature, active())).rejects.toMatchObject({
          code: 'SSH_WORKSPACE_CHANGED',
        });
      }
    );
    it(
      'rejects nonexistent/injected remote targets without falling back to controller Git',
      { timeout: 15000 },
      async () => {
        await expect(
          service.prepare(project, { ...feature, branchName: 'missing' }, active())
        ).rejects.toMatchObject({ code: 'SSH_BRANCH_REQUIRED' });
        await expect(
          service.prepare(
            project,
            { ...feature, id: 'injected', branchName: 'main; printf bad > leaked' },
            active()
          )
        ).rejects.toMatchObject({ code: 'SSH_BRANCH_REQUIRED' });
        await expect(fs.stat(path.join(checkout, 'leaked'))).rejects.toThrow();
        expect(
          (await service.prepare(project, { ...feature, model: 'sonnet' }, active()))!.binding.type
        ).toBe('ssh');
        expect(bodies).toHaveLength(0);
      }
    );
    it(
      'commits only the remote feature and fast-forwards the pinned target without push or deleting worktrees',
      { timeout: 20000 },
      async () => {
        const run = (await service.prepare(project, feature, active()))!;
        await run.environment.writeFile('source.txt', Buffer.from('remote'), active());
        await expect(service.merge(run, active())).rejects.toThrow('Commit remote feature');
        const hash = await service.commit(run, feature, active());
        expect(hash).toMatch(/^[a-f0-9]{40,64}$/);
        expect((await service.status(run, active())).status).toBe('');
        await service.merge(run, active());
        expect(await git('rev-parse', 'main')).toBe(hash);
        expect(await fs.readFile(path.join(checkout, 'source.txt'), 'utf8')).toBe('remote');
        expect(await service.commit(run, feature, active())).toBe(null);
        expect((await fs.stat(run.environment.cwd)).isDirectory()).toBe(true);
        await expect(fs.stat(path.join(project, 'source.txt'))).rejects.toThrow();
        expect(peer.commands.join(' ')).not.toContain('git push');
      }
    );
    it(
      'leaves diverged target/source histories intact and refuses automatic conflict resolution',
      { timeout: 20000 },
      async () => {
        const run = (await service.prepare(project, feature, active()))!;
        await run.environment.writeFile('source.txt', Buffer.from('feature'), active());
        await service.commit(run, feature, active());
        await fs.writeFile(path.join(checkout, 'source.txt'), 'target');
        await git('add', 'source.txt');
        await git('commit', '-qm', 'target');
        const head = await git('rev-parse', 'HEAD');
        await expect(service.merge(run, active())).rejects.toThrow('diverged');
        expect(await git('rev-parse', 'HEAD')).toBe(head);
        expect(await fs.readFile(path.join(checkout, 'source.txt'), 'utf8')).toBe('target');
        await expect(fs.stat(path.join(checkout, '.git', 'MERGE_HEAD'))).rejects.toThrow();
      }
    );
    it(
      'runs the real facade/model/Verify/Commit/merge and resumes a pinned feature after restart',
      { timeout: 40000 },
      async () => {
        const memoryFile = path.join(checkout, '.automaker', 'memory', 'architecture.md');
        await fs.mkdir(path.dirname(memoryFile), { recursive: true });
        await fs.writeFile(memoryFile, '# Memory\n\nRemote immutable workspace bindings');
        const events = createEventEmitter();
        const seen: unknown[] = [];
        events.subscribe((_type, event) => seen.push(event));
        const facade = AutoModeServiceFacade.create(project, {
          filesystem: executionFilesystem,
          pipeline: pipelineService as never,
          providerRegistry: createTestProviderRegistry(settings),
          events,
          settingsService: settings,
          featureLoader: loader,
        });
        const localWorktrees = vi
          .spyOn(WorktreeResolver.prototype, 'findWorktreeForBranch')
          .mockRejectedValue(new Error('Local worktree access is forbidden'));
        respond = (response) =>
          bodies.length === 1
            ? call(response, 'Write', { path: 'result.txt', content: 'remote result' })
            : bodies.length === 2
              ? call(response, 'Bash', { command: 'npm test' })
              : finish(
                  response,
                  'Remote immutable workspace bindings implemented successfully. '.repeat(12)
                );
        await facade.executeFeature(feature.id, true, false);
        expect((await loader.get(project, feature.id))!.status).toBe('waiting_approval');
        const run = (await service.prepare(project, feature, active(), false))!;
        expect(await fs.readFile(path.join(run.environment.cwd, 'result.txt'), 'utf8')).toBe(
          'remote result'
        );
        expect(JSON.stringify(bodies)).toContain('REMOTE_SHARED_RULES');
        expect(JSON.stringify(bodies)).not.toContain('STALE_CONTROLLER_SOURCE_RULES');
        expect(parseFrontmatter(await fs.readFile(memoryFile, 'utf8')).metadata.usageStats).toEqual(
          { loaded: 1, referenced: 1, successfulFeatures: 0 }
        );
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
          vi.fn(),
          pipelineService as never,
          executionFilesystem
        );
        expect(
          await pipeline.executeTestStep(
            {
              projectPath: project,
              featureId: feature.id,
              feature,
              steps: [],
              workDir: project,
              worktreePath: null,
              branchName: feature.branchName ?? null,
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
        for (const script of ['lint', 'typecheck', 'test', 'build'])
          expect(
            await fs.readFile(path.join(run.environment.cwd, `verified-${script}`), 'utf8')
          ).toBe('remote');
        const hash = await facade.commitFeature(feature.id);
        expect(hash).toMatch(/^[a-f0-9]{40,64}$/);
        await facade.mergeSSHFeature(feature.id);
        expect(await git('rev-parse', 'HEAD')).toBe(hash);
        await settings.updateGlobalSettings({
          executionEnvironment: { default: { mode: 'local' }, profiles: [] },
        });
        const restarted = AutoModeServiceFacade.create(project, {
          filesystem: executionFilesystem,
          pipeline: pipelineService as never,
          providerRegistry: createTestProviderRegistry(settings),
          events,
          settingsService: settings,
          featureLoader: loader,
        });
        await restarted.resumeFeature(feature.id, true);
        expect((await service.prepare(project, feature, active(), false))!.binding).toEqual(
          run.binding
        );
        expect(localWorktrees).not.toHaveBeenCalled();
        expect(
          seen.some((event) => (event as { type?: string }).type === 'auto_mode_feature_start')
        ).toBe(true);
        await expect(fs.stat(path.join(project, 'leaked'))).rejects.toThrow();
        await expect(fs.stat(path.join(project, 'result.txt'))).rejects.toThrow();
      }
    );
    it(
      'keeps real planning read-only until approval, then uses the same remote feature workspace',
      { timeout: 40000 },
      async () => {
        feature = { ...feature, planningMode: 'spec', requirePlanApproval: true };
        await loader.update(project, feature.id, feature);
        const events = createEventEmitter();
        let waiting = false;
        events.subscribe((_type, event) => {
          if ((event as { type?: string }).type === 'plan_approval_required') waiting = true;
        });
        const facade = AutoModeServiceFacade.create(project, {
          filesystem: executionFilesystem,
          pipeline: pipelineService as never,
          providerRegistry: createTestProviderRegistry(settings),
          events,
          settingsService: settings,
          featureLoader: loader,
        });
        respond = (response) =>
          bodies.length === 1
            ? finish(response, 'Plan to create approved.txt\n[SPEC_GENERATED]')
            : bodies.length === 2
              ? call(response, 'Write', { path: 'approved.txt', content: 'approved' })
              : finish(response);
        const execution = facade.executeFeature(feature.id, true, false);
        await vi.waitFor(() => expect(waiting).toBe(true), { timeout: 20000 });
        expect(bodies[0].tools?.map((tool) => tool.function.name)).not.toContain('Write');
        const run = (await service.prepare(project, feature, active(), false))!;
        await expect(fs.stat(path.join(run.environment.cwd, 'approved.txt'))).rejects.toThrow();
        const approval = await facade.getPendingPlanApproval(feature.id);
        expect(approval).not.toBeNull();
        expect(
          await facade.resolvePlanApproval(
            feature.id,
            true,
            undefined,
            undefined,
            approval!.approvalToken,
            approval!.planVersion,
            approval!.approvalRunId
          )
        ).toMatchObject({ success: true });
        await execution;
        expect(await fs.readFile(path.join(run.environment.cwd, 'approved.txt'), 'utf8')).toBe(
          'approved'
        );
        expect(bodies[1].tools?.map((tool) => tool.function.name)).toContain('Write');
      }
    );
    it(
      'uses remote context/workspace for pipeline resume and pauses a dirty source rather than claiming merged success',
      { timeout: 35000 },
      async () => {
        const step = {
          id: 'review',
          name: 'Review',
          instructions: 'Review source',
          order: 0,
          colorClass: 'blue',
          createdAt: '',
          updatedAt: '',
        };
        await pipelineService.savePipelineConfig(project, { version: 1, steps: [step] });
        const events = createEventEmitter();
        const facade = AutoModeServiceFacade.create(project, {
          filesystem: executionFilesystem,
          pipeline: pipelineService as never,
          providerRegistry: createTestProviderRegistry(settings),
          events,
          settingsService: settings,
          featureLoader: loader,
        });
        respond = (response) =>
          bodies.length === 1
            ? call(response, 'Write', { path: 'result.txt', content: 'remote' })
            : finish(response);
        await facade.executeFeature(feature.id, true, false);
        expect((await loader.get(project, feature.id))!.status).toBe('waiting_approval');
        const run = (await service.prepare(project, feature, active(), false))!;
        await facade.commitFeature(feature.id);
        await loader.update(project, feature.id, { status: 'pipeline_review' });
        await facade.resumeFeature(feature.id, true);
        expect(await fs.readFile(path.join(checkout, 'result.txt'), 'utf8')).toBe('remote');
        expect(JSON.stringify(bodies.at(-1))).toContain('REMOTE_SHARED_RULES');
        expect((await service.prepare(project, feature, active(), false))!.binding).toEqual(
          run.binding
        );
      }
    );
    it(
      'executes feature shell hooks remotely and refuses project-wide/unbound SSH hooks on the host',
      { timeout: 20000 },
      async () => {
        const run = (await service.prepare(project, feature, active()))!;
        const hooks = new EventHookService(new NtfyService());
        hooks.initialize(new ApplicationEventBusAdapter(createEventEmitter()), settings);
        const invoke = (id?: string) =>
          (
            hooks as unknown as {
              executeShellHook(action: object, context: object, name: string): Promise<void>;
            }
          ).executeShellHook(
            { type: 'shell', command: 'printf hook > "{{projectPath}}/hook-result"' },
            {
              projectPath: project,
              featureId: id,
              eventType: 'feature_success',
              timestamp: new Date().toISOString(),
            },
            'fixture'
          );
        try {
          await invoke(feature.id);
          expect(await fs.readFile(path.join(run.environment.cwd, 'hook-result'), 'utf8')).toBe(
            'hook'
          );
          await expect(invoke()).rejects.toThrow('Managed shell hooks require');
          await expect(invoke('unbound')).rejects.toThrow('Managed shell hooks require');
          await expect(fs.stat(path.join(project, 'hook-result'))).rejects.toThrow();
        } finally {
          await hooks.destroy();
        }
      }
    );
    it(
      'blocks workflow preflight after a real channel loss until explicit recovery, without command replay',
      { timeout: 20000 },
      async () => {
        const run = (await service.prepare(project, feature, active()))!;
        const request = run.environment.exec('printf once >> once; sleep 20', active());
        const rejected = expect(request).rejects.toMatchObject({ code: 'SSH_OUTCOME_UNKNOWN' });
        for (let i = 0; i < 300; i++) {
          if (
            await fs.stat(path.join(run.environment.cwd, 'once')).then(
              () => true,
              () => false
            )
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        peer.disconnect();
        await rejected;
        await expect(
          new SSHFeatureService(settings).prepare(project, feature, active())
        ).rejects.toMatchObject({ code: 'SSH_OUTCOME_UNKNOWN' });
        await manager.recover(run.binding.ssh!);
        const recovered = (await service.prepare(project, feature, active()))!;
        expect(
          (await recovered.environment.readFile('once', 0, 100, active())).data.toString()
        ).toBe('once');
        expect(
          (await new EnvironmentBindingStore(settings).peek(
            project,
            featureRunKey(project, feature.id)
          ))!.sshWorkspace
        ).toEqual(run.binding.sshWorkspace);
      }
    );
    it(
      'drives the real AutoMode queue using the remote primary branch without local source Git',
      { timeout: 35000 },
      async () => {
        const events = createEventEmitter();
        const facade = AutoModeServiceFacade.create(project, {
          filesystem: executionFilesystem,
          pipeline: pipelineService as never,
          providerRegistry: createTestProviderRegistry(settings),
          events,
          settingsService: settings,
          featureLoader: loader,
        });
        respond = (response) =>
          bodies.length === 1
            ? call(response, 'Write', { path: 'queue-result', content: 'remote queue' })
            : finish(response);
        try {
          expect(await facade.startAutoLoop(null, 1)).toBe(1);
          await vi.waitFor(
            async () =>
              expect((await loader.get(project, feature.id))!.status).toBe('waiting_approval'),
            { timeout: 25000, interval: 100 }
          );
          const run = (await service.prepare(project, feature, active(), false))!;
          expect(await fs.readFile(path.join(run.environment.cwd, 'queue-result'), 'utf8')).toBe(
            'remote queue'
          );
          await expect(fs.stat(path.join(project, 'queue-result'))).rejects.toThrow();
        } finally {
          await facade.stopAutoLoop(null);
        }
      }
    );
    it(
      'Stop cancels the real feature command and prevents pipeline/merge completion after abort',
      { timeout: 30000 },
      async () => {
        const events = createEventEmitter();
        const facade = AutoModeServiceFacade.create(project, {
          filesystem: executionFilesystem,
          pipeline: pipelineService as never,
          providerRegistry: createTestProviderRegistry(settings),
          events,
          settingsService: settings,
          featureLoader: loader,
        });
        const run = (await service.prepare(project, feature, active()))!;
        respond = (response) =>
          call(response, 'Bash', {
            command: 'printf started > started; (sleep 2; printf leaked > leaked) & sleep 30; wait',
          });
        const execution = facade.executeFeature(feature.id, true, false);
        await vi.waitFor(
          async () =>
            expect(await fs.readFile(path.join(run.environment.cwd, 'started'), 'utf8')).toBe(
              'started'
            ),
          { timeout: 15000, interval: 50 }
        );
        expect(await facade.stopFeature(feature.id)).toBe(true);
        await execution;
        expect((await loader.get(project, feature.id))!.status).toBe('interrupted');
        await new Promise((resolve) => setTimeout(resolve, 2100));
        await expect(fs.stat(path.join(run.environment.cwd, 'leaked'))).rejects.toThrow();
        expect((await manager.status(profile, project)).project?.pendingOperations).toBe(0);
      }
    );
  }
);
