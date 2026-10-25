import * as executionFilesystem from '../../../src/lib/secure-fs.js';
import { PipelineService } from '../../../src/services/pipeline-service.js';
import { createTestProviderRegistry } from '../../helpers/provider-registry.js';
import {
  createTestAgentState,
  createTestAgentProviders,
  createTestAgentEvents,
} from '../../helpers/agent-state.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripProviderPrefix, type SSHEnvironmentProfile } from '@automaker/types';
import { SettingsService } from '@/services/settings-service.js';
import { ManagedSSH, SSHExecutionEnvironment } from '@/services/execution-environment/ssh.js';
import { EnvironmentBindingStore } from '@/services/execution-environment/bindings.js';
import { SSHFeatureService } from '@/services/execution-environment/ssh-feature.js';
import {
  prepareDirectExecution,
  runDirectShellCommand,
} from '@/providers/openai-compatible/execution.js';
import { AgentService } from '@/services/agent-service.js';
import { createEventEmitter } from '@/lib/events.js';
import { AutoModeServiceFacade } from '@/services/auto-mode/facade.js';
import { FeatureLoader } from '@/services/feature-loader.js';
import { WorktreeResolver } from '@/services/worktree-resolver.js';
import { SSH_WORKER } from '@/services/execution-environment/ssh-worker.js';
import { sshDigest } from '@/services/execution-environment/ssh-state.js';
import { SSHTransportError } from '@/services/execution-environment/ssh-transport.js';
import { sshPeer, testSSHKey } from '../../helpers/ssh-peer.js';

const exec = promisify(execFile);
const active = () => new AbortController().signal;
describe.skipIf(process.platform !== 'linux')(
  'remote CLI providers against a real SSH worker',
  () => {
    let temporary: string,
      project: string,
      remote: string,
      checkout: string,
      settings: SettingsService,
      manager: ManagedSSH,
      profile: SSHEnvironmentProfile,
      peer: Awaited<ReturnType<typeof sshPeer>>;
    beforeEach(async () => {
      vi.stubEnv('AUTOMAKER_MOCK_AGENT', 'false');
      vi.stubEnv('AUTOMAKER_API_KEY', 'CONTROLLER_SECRET_DO_NOT_FORWARD');
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-cli-test-'));
      project = path.join(temporary, 'controller');
      remote = path.join(temporary, "remote 'quoted");
      checkout = path.join(remote, 'checkout');
      await fs.mkdir(project);
      await fs.mkdir(checkout, { recursive: true });
      await fs.writeFile(path.join(project, 'AGENTS.md'), 'STALE_CONTROLLER_CONTEXT_MUST_NOT_LEAK');
      await fs.writeFile(path.join(checkout, 'AGENTS.md'), 'REMOTE_CONTEXT');
      await exec('git', ['-C', checkout, 'init', '-qb', 'main']);
      await exec('git', ['-C', checkout, 'add', '.']);
      await exec('git', [
        '-C',
        checkout,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-qm',
        'init',
      ]);
      const key = testSSHKey();
      peer = await sshPeer(remote, key, undefined, 0, {
        PATH: [
          path.join(remote, '.local/bin'),
          path.dirname(process.execPath),
          '/usr/bin',
          '/bin',
        ].join(':'),
      });
      profile = {
        id: 'ssh',
        name: 'Fixture',
        type: 'ssh',
        host: '127.0.0.1',
        port: peer.port,
        username: 'developer',
        basePath: path.join(remote, 'projects'),
        credentialId: 'key',
      };
      settings = new SettingsService(path.join(temporary, 'data'));
      manager = new ManagedSSH(settings);
      await settings.updateGlobalSettings({
        executionEnvironment: {
          default: { mode: 'profile', profileId: 'ssh' },
          profiles: [profile],
        },
      });
      const candidate = await manager.state.scan(profile);
      await manager.state.confirm(profile, candidate.fingerprint, false);
      await manager.state.saveKey('key', key);
      await manager.prepareProject(
        profile,
        project,
        { method: 'existing', remotePath: checkout },
        active()
      );
      await fs.mkdir(path.join(remote, '.local/bin'), { recursive: true });
      await fs.writeFile(path.join(remote, 'remote-auth'), 'REMOTE_AUTH');
      for (const name of ['cursor-agent', 'gemini', 'opencode'])
        await fs.writeFile(
          path.join(remote, '.local/bin', name),
          `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const send=event=>process.stdout.write(JSON.stringify(event)+'\\n');
(async()=>{
 let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
 if(process.env.AUTOMAKER_API_KEY)throw Error('controller env leaked');
 if(fs.readFileSync(path.join(process.env.HOME,'remote-auth'),'utf8')!=='REMOTE_AUTH')throw Error('missing remote auth');
 fs.writeFileSync('invocation.json',JSON.stringify({args:process.argv.slice(2),prompt,home:process.env.HOME,cwd:process.cwd()}));
 if(!process.argv.includes('ask'))fs.writeFileSync('cli-result.txt','remote-only');
 const name=path.basename(process.argv[1]);
 if(name==='cursor-agent'){send({type:'system',subtype:'init',session_id:'cursor-session'});send({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'CLI complete'}]}});send({type:'result',subtype:'success',result:'CLI complete'});}
 else if(name==='gemini'){send({type:'init',session_id:'gemini-session'});send({type:'message',role:'assistant',content:'CLI complete'});send({type:'result',status:'success'});}
 else{send({type:'text',sessionID:'opencode-session',part:{type:'text',text:'CLI complete'}});send({type:'step_finish',sessionID:'opencode-session',part:{reason:'stop'}});}
})().catch(error=>{process.stderr.write(error.message);process.exitCode=1;});
`,
          { mode: 0o700 }
        );
    }, 15000);
    afterEach(async () => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await peer.close();
      await fs.rm(temporary, { recursive: true, force: true });
    });
    it.each(['cursor-auto', 'gemini-2.5-flash', 'opencode-anthropic/claude-sonnet'])(
      'executes %s in the pinned remote cwd with remote auth, argv and stdin',
      async (model) => {
        const prepared = await prepareDirectExecution(
          {
            prompt: 'literal $(touch leaked) `no`',
            model: stripProviderPrefix(model),
            cwd: project,
          },
          settings,
          { model, projectPath: project, runKey: `chat:${model}` }
        );
        const messages = [];
        for await (const message of createTestProviderRegistry(settings)
          .providerForModel(model, {
            throwOnDisconnected: false,
          })
          .executeQuery(prepared))
          messages.push(message);
        expect(messages.some((message) => message.type === 'assistant')).toBe(true);
        expect(messages.some((message) => message.type === 'result')).toBe(true);
        const cwd = prepared.cwd;
        expect(cwd).not.toBe(project);
        const invocation = JSON.parse(await fs.readFile(path.join(cwd, 'invocation.json'), 'utf8'));
        expect(invocation.prompt).toContain('literal $(touch leaked) `no`');
        expect(invocation.home).toBe(remote);
        expect(invocation.cwd).toBe(cwd);
        expect(await fs.readFile(path.join(cwd, 'cli-result.txt'), 'utf8')).toBe('remote-only');
        await expect(fs.stat(path.join(project, 'cli-result.txt'))).rejects.toThrow();
        await expect(fs.stat(path.join(cwd, 'leaked'))).rejects.toThrow();
        await expect(fs.stat(path.join(cwd, '.geminiignore'))).rejects.toThrow();
      },
      15000
    );
    it('uses the real chat service without controller context and keeps the binding on restart/default change', async () => {
      const service = new AgentService(
        ...createTestAgentState(
          settings.getDataDirectory(),
          createTestAgentEvents(createEventEmitter())
        ),
        settings,
        ...createTestAgentProviders(createTestProviderRegistry(settings))
      );
      await service.initialize();
      const session = await service.createSession('Remote CLI', project, project, 'cursor-auto');
      expect(
        (await service.sendMessage({ sessionId: session.id, message: 'Work remotely' })).success
      ).toBe(true);
      const binding = (await service.listSessions()).find(
        (item) => item.id === session.id
      )!.executionEnvironment!;
      expect(binding.type).toBe('ssh');
      let invocation = await fs.readFile(path.join(binding.runtimeCwd!, 'invocation.json'), 'utf8');
      expect(invocation).not.toContain('STALE_CONTROLLER_CONTEXT_MUST_NOT_LEAK');
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'local' }, profiles: [] },
      });
      const restarted = new AgentService(
        ...createTestAgentState(
          settings.getDataDirectory(),
          createTestAgentEvents(createEventEmitter())
        ),
        settings,
        ...createTestAgentProviders(createTestProviderRegistry(settings))
      );
      await restarted.initialize();
      expect(
        (await restarted.sendMessage({ sessionId: session.id, message: 'Continue' })).success
      ).toBe(true);
      expect(
        (await restarted.listSessions()).find((item) => item.id === session.id)!
          .executionEnvironment
      ).toEqual(binding);
      invocation = await fs.readFile(path.join(binding.runtimeCwd!, 'invocation.json'), 'utf8');
      expect(invocation).toContain('--resume');
      expect(invocation).toContain('cursor-session');
    }, 20000);
    it('runs feature CLI/tests/commit/merge in the same authoritative SSH worktree', async () => {
      const feature = {
        id: 'cli-feature',
        model: 'opencode-anthropic/claude-sonnet',
        branchName: 'main',
      };
      const service = new SSHFeatureService(settings);
      const run = (await service.prepare(project, feature, active()))!;
      const prepared = await prepareDirectExecution(
        { prompt: 'Implement', model: stripProviderPrefix(feature.model), cwd: project },
        settings,
        {
          model: feature.model,
          projectPath: project,
          runKey: `feature:${project}:${feature.id}`,
          feature: { targetBranch: 'main' },
        }
      );
      expect(prepared.cwd).toBe(run.environment.cwd);
      for await (const _message of createTestProviderRegistry(settings)
        .providerForModel(feature.model, {
          throwOnDisconnected: false,
        })
        .executeQuery(prepared)) {
        /* drain */
      }
      expect(
        (
          await runDirectShellCommand(
            settings,
            project,
            'test "$(cat cli-result.txt)" = remote-only',
            active(),
            { projectPath: project, runKey: `feature:${project}:${feature.id}` }
          )
        ).exitCode
      ).toBe(0);
      await service.commit(run, feature, active());
      await service.merge(run, active());
      expect(await fs.readFile(path.join(checkout, 'cli-result.txt'), 'utf8')).toBe('remote-only');
      await expect(fs.stat(path.join(project, '.git'))).rejects.toThrow();
    }, 20000);
    it('runs the real Kanban facade and pinned SSH command without invoking controller worktree services', async () => {
      const loader = new FeatureLoader();
      const feature = await loader.create(project, {
        id: 'facade-cli',
        category: 'Test',
        title: 'Remote CLI feature',
        description: 'Implement remotely',
        model: 'cursor-auto',
        branchName: 'main',
        status: 'ready',
        planningMode: 'skip',
        skipTests: true,
      });
      const events = createEventEmitter();
      const facade = AutoModeServiceFacade.create(project, {
        filesystem: executionFilesystem,
        pipeline: new PipelineService(),
        providerRegistry: createTestProviderRegistry(settings),
        events,
        settingsService: settings,
        featureLoader: loader,
      });
      const localWorktrees = vi
        .spyOn(WorktreeResolver.prototype, 'findWorktreeForBranch')
        .mockRejectedValue(new Error('Controller worktrees forbidden'));
      await facade.executeFeature(feature.id, true, false);
      expect((await loader.get(project, feature.id))!.status).toBe('waiting_approval');
      const run = (await new SSHFeatureService(settings).prepare(
        project,
        feature,
        active(),
        false
      ))!;
      const invocation = await fs.readFile(
        path.join(run.environment.cwd, 'invocation.json'),
        'utf8'
      );
      expect(invocation).toContain('REMOTE_CONTEXT');
      expect(invocation).not.toContain('STALE_CONTROLLER_CONTEXT_MUST_NOT_LEAK');
      expect(localWorktrees).not.toHaveBeenCalled();
      expect(run.environment.type).toBe('ssh');
      expect(
        (await run.environment.exec('test "$(cat cli-result.txt)" = remote-only', active()))
          .exitCode
      ).toBe(0);
      expect(localWorktrees).not.toHaveBeenCalled();

      const commit = await facade.commitFeature(feature.id);
      expect(commit).toMatch(/^[a-f0-9]{40,64}$/);
      await facade.mergeSSHFeature(feature.id);
      expect(await fs.readFile(path.join(checkout, 'cli-result.txt'), 'utf8')).toBe('remote-only');
    }, 30000);
    it('enforces Cursor ask mode without writing implementation files', async () => {
      const prepared = await prepareDirectExecution(
        { prompt: 'Plan only', model: 'auto', cwd: project, readOnly: true },
        settings,
        { model: 'cursor-auto', projectPath: project, runKey: 'chat:readonly' }
      );
      for await (const _message of createTestProviderRegistry(settings)
        .providerForModel('cursor-auto', {
          throwOnDisconnected: false,
        })
        .executeQuery(prepared)) {
        /* drain */
      }
      const invocation = JSON.parse(
        await fs.readFile(path.join(prepared.cwd, 'invocation.json'), 'utf8')
      );
      expect(invocation.args).toContain('ask');
      expect(invocation.args).not.toContain('--force');
      await expect(fs.stat(path.join(prepared.cwd, 'cli-result.txt'))).rejects.toThrow();
      await expect(fs.stat(path.join(project, '.git'))).rejects.toThrow();
    }, 15000);
    it('refuses unsafe modes and controller MCP without dispatching a CLI', async () => {
      for (const model of ['gemini-2.5-flash', 'opencode-anthropic/claude-sonnet'])
        await expect(
          prepareDirectExecution({ prompt: 'x', model, cwd: project, readOnly: true }, settings, {
            model,
            projectPath: project,
          })
        ).rejects.toMatchObject({ code: 'REMOTE_PROVIDER_READ_ONLY_UNSUPPORTED' });
      await expect(
        prepareDirectExecution(
          {
            prompt: 'x',
            model: 'auto',
            cwd: project,
            mcpServers: { host: { command: '/controller/tool' } },
          },
          settings,
          { model: 'cursor-auto', projectPath: project }
        )
      ).rejects.toMatchObject({ code: 'REMOTE_PROVIDER_CONFIG_UNSUPPORTED' });
      expect(await fs.readdir(path.join(checkout, '.worktrees')).catch(() => [])).toEqual([]);
    });
    it('cancels the remote streaming process group and does not release before cleanup', async () => {
      const pinned = await new EnvironmentBindingStore(settings).bind({
        cwd: project,
        projectPath: project,
        key: 'cancel',
        legacySettings: {},
      });
      const environment = new SSHExecutionEnvironment(
        manager,
        pinned.binding.ssh!,
        pinned.binding.runtimeCwd!
      );
      const controller = new AbortController();
      let ready!: () => void;
      const started = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const request = environment.runProcess(
        {
          command: 'node',
          args: [
            '-e',
            `require('node:child_process').spawn('/bin/sh',['-c','sleep 1; printf leaked > child-leaked'],{stdio:'ignore'});process.stdout.write('ready');setTimeout(()=>{},30000);`,
          ],
        },
        controller.signal,
        (stream) => {
          if (stream === 'stdout') ready();
        }
      );
      const assertion = expect(request).rejects.toMatchObject({ code: 'PROCESS_INTERRUPTED' });
      await started;
      controller.abort();
      await assertion;
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await expect(fs.stat(path.join(environment.cwd, 'child-leaked'))).rejects.toThrow();
      expect((await environment.exec('printf usable', active())).output).toBe('usable');
    }, 15000);
    it('reports missing CLI/idle timeout and journals disconnects without replaying effects', async () => {
      const pinned = await new EnvironmentBindingStore(settings).bind({
        cwd: project,
        projectPath: project,
        key: 'errors',
        legacySettings: {},
      });
      const environment = new SSHExecutionEnvironment(
        manager,
        pinned.binding.ssh!,
        pinned.binding.runtimeCwd!
      );
      await expect(
        environment.runProcess({ command: 'automaker-missing-cli', args: [] }, active(), () => {})
      ).rejects.toMatchObject({ code: 'PROCESS_NOT_INSTALLED' });
      await expect(
        environment.runProcess(
          { command: 'node', args: ['-e', `setTimeout(()=>{},30000)`], idleTimeoutMs: 50 },
          active(),
          () => {}
        )
      ).rejects.toMatchObject({ code: 'PROCESS_INTERRUPTED' });
      const original = manager.run.bind(manager);
      vi.spyOn(manager, 'run').mockImplementation(async (...args) => {
        const result = await original(...args);
        if (typeof args[3]?.input === 'string' && JSON.parse(args[3].input).operation === 'process')
          throw new SSHTransportError('SSH_OUTCOME_UNKNOWN', 'fixture channel loss', true);
        return result;
      });
      await expect(
        environment.runProcess(
          { command: 'node', args: ['-e', `require('node:fs').appendFileSync('effects','once')`] },
          active(),
          () => {}
        )
      ).rejects.toMatchObject({ code: 'SSH_OUTCOME_UNKNOWN' });
      expect(await fs.readFile(path.join(environment.cwd, 'effects'), 'utf8')).toBe('once');
      await expect(new ManagedSSH(settings).verify(pinned.binding.ssh!)).rejects.toMatchObject({
        code: 'SSH_OUTCOME_UNKNOWN',
      });
      await manager.recover(pinned.binding.ssh!);
      expect(await fs.readFile(path.join(environment.cwd, 'effects'), 'utf8')).toBe('once');
    }, 20000);
    it('upgrades a prepared SSH project worker explicitly without retargeting existing bindings', async () => {
      const recordDirectory = path.join(
        settings.getDataDirectory(),
        'execution-environments',
        'ssh',
        'workers'
      );
      const file = path.join(recordDirectory, (await fs.readdir(recordDirectory))[0]);
      const record = JSON.parse(await fs.readFile(file, 'utf8'));
      const source = SSH_WORKER + '\n// fixture previous worker';
      const previous = {
        workerPath: path.join(path.dirname(record.workerPath), 'previous.cjs'),
        workerHash: sshDigest(source),
      };
      await fs.writeFile(previous.workerPath, source, { mode: 0o600 });
      await fs.writeFile(file, JSON.stringify({ ...record, ...previous }), { mode: 0o600 });
      const trusted = (await manager.state.trust(profile))!;
      const projectBinding = (await manager.state.project(profile, trusted.fingerprint, project))!;
      await manager.state.saveProject({ ...projectBinding, ...previous });
      const store = new EnvironmentBindingStore(settings);
      const old = await store.bind({
        cwd: project,
        projectPath: project,
        key: 'old-worker',
        legacySettings: {},
      });
      const environment = new SSHExecutionEnvironment(
        manager,
        old.binding.ssh!,
        old.binding.runtimeCwd!
      );
      expect(() =>
        environment.runProcess({ command: 'node', args: [] }, active(), () => {})
      ).toThrow('older SSH worker');
      await manager.prepareProject(
        profile,
        project,
        { method: 'existing', remotePath: checkout },
        active()
      );
      const next = await store.bind({
        cwd: project,
        projectPath: project,
        key: 'new-worker',
        legacySettings: {},
      });
      expect(next.binding.ssh!.workerHash).toBe(sshDigest(SSH_WORKER));
      expect((await store.peek(project, 'old-worker'))!.ssh!.workerHash).toBe(previous.workerHash);
      expect((await environment.exec('printf old-still-works', active())).output).toBe(
        'old-still-works'
      );
    }, 20000);
  }
);
