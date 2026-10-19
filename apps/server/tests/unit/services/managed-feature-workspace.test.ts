import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@/services/settings-service.js';
import { EnvironmentBindingStore } from '@/services/execution-environment/bindings.js';
import { ManagedDocker } from '@/services/execution-environment/docker.js';
import { LocalExecutionEnvironment } from '@/services/execution-environment/local.js';
import {
  prepareManagedFeatureWorkspace,
  verifyManagedFeatureWorkspace,
} from '@/services/execution-environment/managed-feature-workspace.js';
import { FeatureWorkspaceService } from '@/services/execution-environment/feature-workspace.js';
import { ProjectGitService, workspaceAlias } from '@/services/execution-environment/project-git.js';
import { ManagedTestRunnerService } from '@/services/execution-environment/test-runner.js';
import { ManagedDevServerService } from '@/services/execution-environment/dev-server.js';
import { createEventEmitter } from '@/lib/events.js';

const active = () => new AbortController().signal;
describe.skipIf(process.platform !== 'linux')(
  'managed feature intent and explicit Auto fallback',
  () => {
    let temporary: string,
      project: string,
      settings: SettingsService,
      environment: LocalExecutionEnvironment,
      store: EnvironmentBindingStore;
    beforeEach(async () => {
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'managed-feature-'));
      project = path.join(temporary, 'project');
      await fs.mkdir(project);
      environment = await LocalExecutionEnvironment.create(project);
      await environment.writeFile('source.txt', Buffer.from('base'), active());
      await environment.writeFile(
        '.gitignore',
        Buffer.from('.automaker/\n.worktrees/\n'),
        active()
      );
      expect(
        (
          await environment.exec(
            'git init -qb main && git add . && git -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm base',
            active()
          )
        ).exitCode
      ).toBe(0);
      settings = new SettingsService(path.join(temporary, 'data'));
      store = new EnvironmentBindingStore(
        settings,
        new ManagedDocker(settings, async () => ({
          code: 1,
          stdout: '',
          stderr: 'fixture unavailable',
        }))
      );
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'auto' }, profiles: [] },
      });
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      await fs.rm(temporary, { recursive: true, force: true });
    });
    const feature = { id: 'feature', model: 'cursor-auto', branchName: 'main' };
    const key = () => `feature:${project}:${feature.id}`;
    const bind = () =>
      store.bind({
        projectPath: project,
        cwd: project,
        key: key(),
        legacySettings: {},
        feature: { targetBranch: 'main' },
      });
    const prepare = () =>
      prepareManagedFeatureWorkspace({
        environment,
        directory: settings.getDataDirectory(),
        id: 'a'.repeat(64),
        root: project,
        targetBranch: 'main',
        signal: active(),
      });
    it('requires fallback consent before creating a worktree or binding', async () => {
      await expect(bind()).rejects.toThrow('Auto Local fallback requires');
      await expect(fs.stat(path.join(project, '.worktrees'))).rejects.toThrow();
      expect(await store.peek(project, key())).toBeUndefined();
    });
    it(
      'runs supervised manual tests and preview in the confirmed pinned Local feature, not its project root',
      { timeout: 30000 },
      async () => {
        await store.confirm(project, true);
        const { binding } = await bind();
        await settings.updateGlobalSettings({
          executionEnvironment: { default: { mode: 'local' }, profiles: [] },
        });
        const target = (await new ProjectGitService(settings).resolve(workspaceAlias(binding)!))!;
        expect(target.runtime.type).toBe('local');
        const tests = new ManagedTestRunnerService(settings, createEventEmitter());
        const dev = new ManagedDevServerService(settings, createEventEmitter());
        try {
          await settings.updateProjectSettings(project, {
            testCommand: "pwd; printf 'LOCAL_PINNED\\n'; sleep 60 & echo $! > manual.pid; wait",
          });
          const test = await tests.start(target, target.environment.targetId, undefined);
          await vi.waitFor(() =>
            expect(tests.find(undefined, test.sessionId)?.logs).toContain('LOCAL_PINNED')
          );
          expect(test.executionEnvironment.runtimeCwd).toBe(binding.runtimeCwd);
          await tests.stop(test.sessionId);
          expect(tests.find(undefined, test.sessionId)?.status).toBe('cancelled');
          await expect(fs.stat(path.join(project, 'manual.pid'))).rejects.toThrow();
          await settings.updateProjectSettings(project, {
            devCommand: `node -e "require('node:http').createServer((q,s)=>s.end(process.cwd())).listen(Number(process.env.PORT),'127.0.0.1')"`,
          });
          const started = await dev.start(target, target.environment.targetId);
          await vi.waitFor(() => expect(dev.find(undefined, started.sessionId)?.ready).toBe(true), {
            timeout: 15000,
          });
          const token = new URL(started.url).hash.slice(1);
          const response = await fetch(`http://127.0.0.1:${started.port}/`, {
            headers: { Cookie: `automaker_preview_${started.port}=${token}` },
          });
          expect(await response.text()).toBe(binding.runtimeCwd);
          await dev.stop(started.sessionId);
        } finally {
          await tests.cleanup();
          await dev.cleanup();
        }
      }
    );
    it('pins a separate Local fallback workspace across restart/default changes and commits/merges through it', async () => {
      await store.confirm(project, true);
      const first = (await bind()).binding;
      expect(first).toMatchObject({
        type: 'local',
        cwd: project,
        fallbackReason: 'docker-preflight-unavailable',
        featureWorkspace: { baseBranch: 'main' },
      });
      expect(first.runtimeCwd).not.toBe(project);
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'local' }, profiles: [] },
      });
      const service = new FeatureWorkspaceService(settings);
      const run = (await service.prepare(project, feature, active(), false))!;
      expect(run.binding).toEqual(first);
      await run.environment.writeFile('source.txt', Buffer.from('feature'), active());
      expect(await fs.readFile(path.join(project, 'source.txt'), 'utf8')).toBe('base');
      expect(await service.commit(run, { ...feature, description: 'Fallback' }, active())).toMatch(
        /^[a-f0-9]{40,64}$/
      );
      await service.merge(run, active());
      expect(await fs.readFile(path.join(project, 'source.txt'), 'utf8')).toBe('feature');
      await store.revoke(project, true);
      await expect(service.prepare(project, feature, active(), false)).rejects.toThrow(
        'explicit server-side'
      );
    });
    it('rejects retargeting and branch replacement without repairing either', async () => {
      const prepared = await prepare();
      const runtime = await LocalExecutionEnvironment.create(prepared.runtimeCwd);
      await expect(
        prepareManagedFeatureWorkspace({
          environment,
          directory: settings.getDataDirectory(),
          id: 'a'.repeat(64),
          root: project,
          targetBranch: 'other',
          signal: active(),
        })
      ).rejects.toMatchObject({ code: 'FEATURE_WORKSPACE_CHANGED' });
      await runtime.exec('git checkout -qb changed', active());
      await expect(
        verifyManagedFeatureWorkspace(runtime, project, prepared.workspace, active())
      ).rejects.toMatchObject({ code: 'FEATURE_WORKSPACE_CHANGED' });
      expect((await runtime.exec('git branch --show-current', active())).output.trim()).toBe(
        'changed'
      );
    });
    it('reconciles a successful but unacknowledged create by read-only verification, never a second Git create', async () => {
      const original = environment.exec.bind(environment);
      let creations = 0;
      const spy = vi
        .spyOn(environment, 'exec')
        .mockImplementation(async (command, signal, options) => {
          const result = await original(command, signal, options);
          if (command.includes('fs.mkdirSync(parent')) {
            creations++;
            throw new Error('fixture lost acknowledgement');
          }
          return result;
        });
      await expect(prepare()).rejects.toThrow('lost acknowledgement');
      spy.mockRestore();
      const next = await prepare();
      expect(creations).toBe(1);
      expect(next.workspace.baseBranch).toBe('main');
      expect((await environment.exec('git worktree list --porcelain', active())).output).toContain(
        next.runtimeCwd
      );
    });
    it('does not replay an interrupted create that left no worktree', async () => {
      const original = environment.exec.bind(environment);
      const spy = vi
        .spyOn(environment, 'exec')
        .mockImplementation(async (command, signal, options) => {
          if (command.includes('fs.mkdirSync(parent'))
            throw new Error('fixture interrupted before dispatch');
          return original(command, signal, options);
        });
      await expect(prepare()).rejects.toThrow('interrupted');
      spy.mockRestore();
      const calls = vi.spyOn(environment, 'exec');
      await expect(prepare()).rejects.toMatchObject({
        code: 'FEATURE_WORKSPACE_RECOVERY_REQUIRED',
      });
      expect(calls.mock.calls.some(([command]) => command.includes('fs.mkdirSync(parent'))).toBe(
        false
      );
    });
    it('refuses a partially checked-out worktree after a lost creation result', async () => {
      const original = environment.exec.bind(environment);
      const spy = vi
        .spyOn(environment, 'exec')
        .mockImplementation(async (command, signal, options) => {
          const result = await original(command, signal, options);
          if (command.includes('fs.mkdirSync(parent')) {
            await fs.unlink(
              path.join(project, '.worktrees', 'feature-' + 'a'.repeat(24), 'source.txt')
            );
            throw new Error('fixture partial checkout');
          }
          return result;
        });
      await expect(prepare()).rejects.toThrow('partial checkout');
      spy.mockRestore();
      await expect(prepare()).rejects.toMatchObject({
        code: 'FEATURE_WORKSPACE_RECOVERY_REQUIRED',
      });
    });
    it('pins the environment before interrupted worktree effects even when defaults change', async () => {
      await store.confirm(project, true);
      const original = LocalExecutionEnvironment.prototype.exec;
      const spy = vi
        .spyOn(LocalExecutionEnvironment.prototype, 'exec')
        .mockImplementation(function (command, signal, options) {
          if (command.includes('fs.mkdirSync(parent'))
            return Promise.reject(new Error('fixture interruption'));
          return original.call(this, command, signal, options);
        });
      await expect(bind()).rejects.toThrow('fixture interruption');
      spy.mockRestore();
      expect(await store.peek(project, key())).toMatchObject({
        type: 'local',
        featurePreparation: { targetBranch: 'main' },
      });
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'local' }, profiles: [] },
      });
      await expect(
        new FeatureWorkspaceService(settings).prepare(project, feature, active())
      ).rejects.toMatchObject({ code: 'FEATURE_WORKSPACE_RECOVERY_REQUIRED' });
    });
    it('refuses a symlinked worktree parent before any feature Git effect', async () => {
      const outside = path.join(temporary, 'outside');
      await fs.mkdir(outside);
      await fs.symlink(outside, path.join(project, '.worktrees'));
      await expect(prepare()).rejects.toMatchObject({ code: 'FEATURE_BRANCH_REQUIRED' });
      expect(await fs.readdir(outside)).toEqual([]);
    });
    it('refuses a native Windows fallback before dispatching POSIX commands', async () => {
      const exec = vi.spyOn(environment, 'exec');
      await expect(
        prepareManagedFeatureWorkspace({
          environment: { ...environment, platform: 'win32' } as LocalExecutionEnvironment,
          directory: settings.getDataDirectory(),
          id: 'a'.repeat(64),
          root: project,
          signal: active(),
        })
      ).rejects.toMatchObject({ code: 'FEATURE_PLATFORM_UNSUPPORTED' });
      expect(exec).not.toHaveBeenCalled();
    });
  }
);
