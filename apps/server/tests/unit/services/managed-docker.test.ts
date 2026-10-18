import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@/services/settings-service.js';
import {
  ManagedDocker,
  DockerExecutionEnvironment,
} from '@/services/execution-environment/docker.js';
import {
  type DockerRunner,
  dockerArguments,
} from '@/services/execution-environment/docker-command.js';
import {
  DOCKER_CANCEL,
  DOCKER_INIT,
  DOCKER_WORKER,
} from '@/services/execution-environment/docker-worker.js';
import { EnvironmentBindingStore } from '@/services/execution-environment/bindings.js';
import { ExecutionEnvironmentError } from '@/services/execution-environment/runtime.js';
import { searchEnvironment } from '@/services/execution-environment/search.js';
import vm from 'node:vm';

const imageId = 'sha256:' + 'a'.repeat(64);
const ok = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const unavailable = { code: 1, stdout: '', stderr: 'not available' };
describe.skipIf(process.platform !== 'linux')(
  'managed Docker controller and real worker protocol (no daemon required)',
  () => {
    let temporary: string, project: string, settings: SettingsService, manager: ManagedDocker;
    let engineId: string,
      available: boolean,
      image: boolean,
      failExec: boolean,
      failRemove: boolean,
      failBuild: boolean;
    let controllerMounts: Array<{
      Type: string;
      Name?: string;
      Source: string;
      Destination: string;
      RW: boolean;
    }>;
    const containers = new Map<string, ReturnType<typeof fixtureContainer>>();
    const calls: string[][] = [];
    function fixtureContainer(args: string[], id: string) {
      const value = (flag: string) => args[args.indexOf(flag) + 1];
      const fields = Object.fromEntries(
        (args.includes('--mount') ? value('--mount') : '').split(',').map((part) => part.split('='))
      );
      const labels = Object.fromEntries(
        args.flatMap((part, index) => (part === '--label' ? [args[index + 1].split('=')] : []))
      );
      const start = args.indexOf(imageId);
      return {
        Id: id,
        Image: imageId,
        State: { Running: false },
        Config: {
          Labels: labels,
          User: args.includes('--user') ? value('--user') : '',
          Env: [],
          Entrypoint: ['node'],
          Cmd: args.slice(start + 1),
        },
        HostConfig: {
          Privileged: false,
          NetworkMode: args.includes('--network') ? value('--network') : 'default',
          PidMode: '',
          IpcMode: 'private',
          CapDrop: ['ALL'],
          CapAdd: [] as string[],
          SecurityOpt: ['no-new-privileges:true'],
          Mounts: fields.type
            ? [
                {
                  Type: fields.type,
                  Source: fields.source,
                  Target: fields.target,
                  VolumeOptions: { Subpath: fields['volume-subpath'] },
                },
              ]
            : [],
        },
        Mounts: fields.type
          ? [
              {
                Type: fields.type,
                Source: fields.source,
                Name: fields.type === 'volume' ? fields.source : undefined,
                Destination: fields.target,
                RW: true,
              },
            ]
          : [],
      };
    }
    const runner: DockerRunner = async (raw, options = {}) => {
      const args = raw[0] === '--context' ? raw.slice(2) : raw;
      calls.push(args);
      if (args[0] === 'info')
        return available ? ok({ ID: engineId, OSType: 'linux' }) : unavailable;
      if (args[0] === 'inspect') return ok(controllerMounts);
      if (args[0] === 'image')
        return image
          ? ok([{ Id: imageId, Config: { Labels: { 'dev.automaker.worker': '1' } } }])
          : unavailable;
      if (args[0] === 'build') {
        if (failBuild) return unavailable;
        image = true;
        return ok(null);
      }
      if (args[0] === 'create') {
        const id = containers.size.toString(16).padStart(64, '0');
        const container = fixtureContainer(args, id);
        containers.set(id, container);
        containers.set(args[args.indexOf('--name') + 1], container);
        return { code: 0, stdout: id, stderr: '' };
      }
      if (args[0] === 'container') {
        const found = containers.get(args[2]);
        return found ? ok([found]) : unavailable;
      }
      if (args[0] === 'start') {
        containers.get(args[1])!.State.Running = true;
        return ok(null);
      }
      if (args[0] === 'rm') {
        if (failRemove) return unavailable;
        const found = containers.get(args.at(-1)!);
        for (const [key, value] of containers) if (value === found) containers.delete(key);
        return ok(null);
      }
      if (args[0] === 'exec') {
        if (failExec) return unavailable;
        const cwd = args.includes('--workdir') ? args[args.indexOf('--workdir') + 1] : project;
        const source = args[args.indexOf('-e') + 1].replaceAll(
          '/tmp/automaker-jobs',
          path.join(temporary, 'jobs')
        );
        const workerArgs = ['-e', source, ...args.slice(args.indexOf('-e') + 2)];
        return new Promise((resolve, reject) => {
          const child = spawn(process.execPath, workerArgs, {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          let stdout = '',
            stderr = '';
          child.stdout.on('data', (chunk) => {
            stdout += chunk;
          });
          child.stderr.on('data', (chunk) => {
            stderr += chunk;
          });
          child.stdin.on('error', () => {});
          child.stdin.end(options.input ?? '');
          const stop = () => child.kill('SIGKILL');
          options.signal?.addEventListener('abort', stop, { once: true });
          child.on('error', reject);
          child.on('close', (code) => {
            options.signal?.removeEventListener('abort', stop);
            resolve({ code, stdout, stderr });
          });
        });
      }
      throw new Error('Unexpected Docker command ' + args[0]);
    };
    beforeEach(async () => {
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'managed-docker-test-'));
      project = path.join(temporary, 'project');
      await fs.mkdir(project);
      settings = new SettingsService(path.join(temporary, 'data'));
      manager = new ManagedDocker(settings, runner);
      engineId = 'engine-a';
      available = true;
      image = false;
      failExec = false;
      failRemove = false;
      failBuild = false;
      controllerMounts = [];
      calls.length = 0;
      containers.clear();
      vi.stubEnv('IS_CONTAINERIZED', 'false');
    });
    afterEach(async () => {
      vi.unstubAllEnvs();
      await fs.rm(temporary, { recursive: true, force: true });
    });
    const active = () => new AbortController().signal;
    async function runtime(cwd = project) {
      const binding = await manager.prepare(project, cwd);
      return new DockerExecutionEnvironment(manager, binding, cwd);
    }
    it('performs read-only preflight, never interpreting contexts as CLI options', async () => {
      expect((await manager.preflight(project, project, 'desktop-linux')).mount).toEqual({
        type: 'bind',
        source: project,
      });
      expect(calls.map((args) => args[0])).toEqual(['info']);
      expect(() => dockerArguments('--host=evil', [])).toThrow('Invalid');
    });
    it('automatically builds once and reuses one container across restarts and worktrees', async () => {
      const worktree = path.join(project, '.worktrees', 'task');
      await fs.mkdir(worktree, { recursive: true });
      const first = await runtime();
      await first.writeFile('node_modules/cache.bin', Buffer.from([0, 255, 13]), active());
      const second = await new ManagedDocker(settings, runner).prepare(project, worktree);
      expect(second.containerId).toBe(first.binding.containerId);
      containers.get(second.containerId)!.State.Running = false;
      const third = await runtime(worktree);
      expect((await third.readFile('../../node_modules/cache.bin', 0, 10, active())).data).toEqual(
        Buffer.from([0, 255, 13])
      );
      expect(calls.filter((args) => args[0] === 'build')).toHaveLength(1);
      expect(calls.filter((args) => args[0] === 'create')).toHaveLength(1);
      const create = calls.find((args) => args[0] === 'create')!;
      expect(create).not.toContain('--privileged');
      expect(create.join(' ')).not.toContain('docker.sock');
      expect(create).not.toContain('--volumes-from');
      expect(create).toContain('--cap-drop');
    });
    it('serializes concurrent preparation and separates projects', async () => {
      const [a, b] = await Promise.all([
        manager.prepare(project, project),
        manager.prepare(project, project),
      ]);
      expect(a.containerId).toBe(b.containerId);
      const other = path.join(temporary, 'other');
      await fs.mkdir(other);
      expect((await manager.prepare(other, other)).containerId).not.toBe(a.containerId);
    });
    it('uses controller host bind mapping rather than the client path', async () => {
      vi.stubEnv('IS_CONTAINERIZED', 'true');
      controllerMounts = [
        { Type: 'bind', Source: '/daemon/projects', Destination: temporary, RW: true },
      ];
      expect((await manager.preflight(project, project)).mount).toEqual({
        type: 'bind',
        source: '/daemon/projects/project',
      });
    });
    it('restricts named volumes to the project subpath and rejects hidden nested mounts', async () => {
      vi.stubEnv('IS_CONTAINERIZED', 'true');
      controllerMounts = [
        {
          Type: 'volume',
          Name: 'projects',
          Source: '/daemon/volume',
          Destination: temporary,
          RW: true,
        },
      ];
      expect((await manager.preflight(project, project)).mount).toEqual({
        type: 'volume',
        source: 'projects',
        subpath: 'project',
      });
      controllerMounts.push({
        Type: 'bind',
        Source: '/var/run/docker.sock',
        Destination: path.join(project, 'socket'),
        RW: true,
      });
      await expect(manager.preflight(project, project)).rejects.toThrow('without nested mounts');
    });
    it('refuses nonshared container layers, external worktrees and external Git metadata', async () => {
      vi.stubEnv('IS_CONTAINERIZED', 'true');
      await expect(manager.preflight(project, project)).rejects.toThrow('writable bind mount');
      vi.stubEnv('IS_CONTAINERIZED', 'false');
      await expect(manager.preflight(project, temporary)).rejects.toThrow(
        'Worktrees must be inside'
      );
      await fs.writeFile(path.join(project, '.git'), 'gitdir: ../external');
      await expect(manager.preflight(project, project)).rejects.toThrow('Git metadata outside');
    });
    it('pins Engine/configuration and refuses foreign or expanded container mounts', async () => {
      const environment = await runtime();
      engineId = 'different-engine';
      await expect(environment.mkdir('dir', active())).rejects.toThrow('different Engine');
      engineId = 'engine-a';
      containers.get(environment.binding.containerId)!.HostConfig.Privileged = true;
      await expect(environment.exec('echo never', active())).rejects.toThrow(
        'configuration/ownership'
      );
      expect(calls.filter((args) => args[0] === 'rm')).toHaveLength(0);
    });
    it('verifies lifecycle without host mounts and removes only its own temporary probe', async () => {
      const result = await manager.probe();
      expect(result.projectStorage).toBe('not-tested');
      expect(result.containerLifecycle).toBe('verified');
      expect(calls.find((args) => args[0] === 'create')).not.toContain('--mount');
      expect(calls.filter((args) => args[0] === 'rm')).toHaveLength(1);
      expect(containers.size).toBe(0);
    });
    it('cleans a failed exec probe and surfaces remove failures', async () => {
      failExec = true;
      await expect(manager.probe()).rejects.toThrow('probe failed');
      expect(containers.size).toBe(0);
      failExec = false;
      failRemove = true;
      await expect(manager.probe()).rejects.toThrow('cleanup failed');
    });
    it('refuses cleanup if a probe resource is no longer owned by this installation', async () => {
      const guarded: DockerRunner = async (args, options) => {
        const result = await runner(args, options);
        if (args[0] === 'exec')
          for (const container of containers.values())
            container.Config.Labels['dev.automaker.owner'] = 'foreign';
        return result;
      };
      await expect(new ManagedDocker(settings, guarded).probe()).rejects.toThrow(
        'No foreign resources were removed'
      );
      expect(calls.some((args) => args[0] === 'rm')).toBe(false);
    });
    it('fails closed for a storage mismatch and repeats verification on the next preparation', async () => {
      const wrongCopy: DockerRunner = async (args, options) => {
        if (args.includes(DOCKER_WORKER) && JSON.parse(options?.input ?? '{}').operation === 'read')
          return ok({
            ok: true,
            value: { data: Buffer.from('different working copy').toString('base64'), size: 22 },
          });
        return runner(args, options);
      };
      await expect(
        new ManagedDocker(settings, wrongCopy).prepare(project, project)
      ).rejects.toMatchObject({ code: 'DOCKER_STORAGE_UNVERIFIED' });
      expect(await fs.readdir(project)).toEqual([]);
      const recovered = await manager.prepare(project, project);
      expect(recovered.containerId).toHaveLength(64);
      expect(calls.filter((args) => args[0] === 'create')).toHaveLength(1);
    });
    it('rejects a managed image with an unexpected version before creating a container', async () => {
      const wrongVersion: DockerRunner = async (args, options) =>
        args[0] === 'image'
          ? ok([{ Id: imageId, Config: { Labels: { 'dev.automaker.worker': 'other-version' } } }])
          : runner(args, options);
      await expect(
        new ManagedDocker(settings, wrongVersion).prepare(project, project)
      ).rejects.toMatchObject({ code: 'DOCKER_IMAGE_INVALID' });
      expect(calls.some((args) => args[0] === 'create')).toBe(false);
    });
    it('reports project readiness only after lifecycle and two-way storage verification', async () => {
      const result = await manager.probe(undefined, project);
      expect(result.projectStorage).toBe('verified');
      expect(result.containerId).toHaveLength(64);
      expect(
        (await fs.readdir(project)).filter((name) => name.startsWith('.automaker-storage'))
      ).toEqual([]);
    });
    it('runs binary file/edit/delete and bounded shell operations through the actual worker', async () => {
      const environment = await runtime();
      await environment.mkdir('deep/dir', active());
      await environment.writeFile('deep/dir/file', Buffer.from([0, 128, 255]), active(), null);
      expect((await environment.readFile('deep/dir/file', 1, 2, active())).data).toEqual(
        Buffer.from([128, 255])
      );
      await expect(
        environment.writeFile('deep/dir/file', Buffer.from('bad'), active(), null)
      ).rejects.toMatchObject({ code: 'FILE_CONFLICT' });
      expect((await environment.listDirectory('deep/dir', 10, active())).entries).toEqual([
        { name: 'file', type: 'file' },
      ]);
      const result = await environment.exec('printf abcdef; exit 7', active(), {
        maxOutputBytes: 4,
      });
      expect(result).toEqual({ exitCode: 7, output: 'abcd', truncated: true });
      await environment.remove('deep', true, active());
      await expect(fs.stat(path.join(project, 'deep'))).rejects.toMatchObject({ code: 'ENOENT' });
    });
    it('times out a command without rolling back its effects or replaying it', async () => {
      const environment = await runtime();
      await expect(
        environment.exec('printf x >> effects; sleep 20', active(), { timeoutMs: 100 })
      ).rejects.toMatchObject({ code: 'PROCESS_INTERRUPTED' });
      expect(await fs.readFile(path.join(project, 'effects'), 'utf8')).toBe('x');
      expect(
        calls.filter((args) => args.includes(DOCKER_WORKER) && args[0] === 'exec')
      ).toHaveLength(3); // two storage operations + one command
    });
    it('batches bounded Glob/Grep into a single worker request and skips dependency trees by default', async () => {
      const environment = await runtime();
      await environment.writeFile('src/test.ts', Buffer.from('Alpha needle\nother'), active());
      await environment.writeFile('node_modules/hidden.ts', Buffer.from('needle'), active());
      calls.length = 0;
      expect(
        (
          await searchEnvironment(
            environment,
            { glob: '**/*.ts', text: 'NEEDLE', caseSensitive: false },
            active()
          )
        ).matches
      ).toEqual([{ path: path.join('src', 'test.ts'), line: 1, text: 'Alpha needle' }]);
      expect(calls.filter((args) => args[0] === 'exec')).toHaveLength(1);
      expect(
        (
          await searchEnvironment(
            environment,
            { glob: '**/*.ts', includeDependencies: true },
            active()
          )
        ).files
      ).toHaveLength(2);
      await expect(environment.search({ glob: '../../*' }, active())).rejects.toMatchObject({
        code: 'INVALID_PATTERN',
      });
    });
    it('cancels a remote process group without stopping another project command', async () => {
      const environment = await runtime();
      const controller = new AbortController();
      const command = environment.exec(
        'printf ready > started; (sleep 1; printf leaked > leaked) & wait',
        controller.signal
      );
      const assertion = expect(command).rejects.toMatchObject({ code: 'PROCESS_INTERRUPTED' });
      for (let i = 0; i < 100; i++) {
        if (
          await fs.stat(path.join(project, 'started')).then(
            () => true,
            () => false
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const other = environment.exec('sleep 0.2; printf survived', active());
      controller.abort();
      await assertion;
      expect((await other).output).toBe('survived');
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await expect(fs.stat(path.join(project, 'leaked'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(calls.some((args) => args.includes(DOCKER_CANCEL))).toBe(true);
      expect(calls.some((args) => args[0] === 'stop')).toBe(false);
    });
    it('makes unverified remote cleanup fatal, never a successful cancellation', async () => {
      const binding = await manager.prepare(project, project);
      const badRunner: DockerRunner = async (args, options) =>
        args.includes(DOCKER_WORKER) || args.includes(DOCKER_CANCEL)
          ? unavailable
          : runner(args, options);
      const environment = new DockerExecutionEnvironment(
        new ManagedDocker(settings, badRunner),
        binding,
        project
      );
      await expect(environment.exec('unknown', active())).rejects.toMatchObject({
        code: 'PROCESS_CLEANUP_FAILED',
      });
    });
    it('registers a worker and waits out an idle-stop decision before executing commands', async () => {
      const environment = await runtime();
      const stopping = path.join(temporary, 'jobs-stopping');
      await fs.writeFile(stopping, 'stopping');
      const request = environment.exec('printf ran > after-idle', active());
      for (let i = 0; i < 100; i++) {
        if (
          (await fs.readdir(path.join(temporary, 'jobs'))).some((name) => name.endsWith('.running'))
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await expect(fs.stat(path.join(project, 'after-idle'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await fs.unlink(stopping);
      expect((await request).exitCode).toBe(0);
      expect(await fs.readFile(path.join(project, 'after-idle'), 'utf8')).toBe('ran');
    });
    it('requires separate Auto fallback consent, persists Local pin, and rechecks revocation', async () => {
      const store = new EnvironmentBindingStore(settings, manager);
      await store.confirm(); // unrelated Local grant must not authorize Auto fallback
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'auto' }, profiles: [] },
      });
      available = false;
      const bind = () =>
        store.bind({ cwd: project, projectPath: project, key: 'auto', legacySettings: {} });
      await expect(bind()).rejects.toThrow('Auto Local fallback requires');
      await store.confirm(project, true);
      const first = await bind();
      expect(first.binding).toMatchObject({
        type: 'local',
        selection: { mode: 'auto' },
        fallbackReason: 'docker-preflight-unavailable',
      });
      available = true;
      expect((await bind()).binding).toEqual(first.binding);
      await store.revoke(project, true);
      await expect(bind()).rejects.toThrow('Auto Local fallback requires');
    });
    it('pins Docker across settings changes/restart and never falls back after build failure', async () => {
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'auto' }, profiles: [] },
      });
      const store = new EnvironmentBindingStore(settings, manager);
      await store.confirm(undefined, true);
      failBuild = true;
      await expect(
        store.bind({ cwd: project, projectPath: project, key: 'run', legacySettings: {} })
      ).rejects.toBeInstanceOf(ExecutionEnvironmentError);
      failBuild = false;
      const first = await store.bind({
        cwd: project,
        projectPath: project,
        key: 'run',
        legacySettings: {},
      });
      expect(first.binding.type).toBe('docker');
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'local' }, profiles: [] },
      });
      const restarted = new EnvironmentBindingStore(settings, new ManagedDocker(settings, runner));
      expect(
        (
          await restarted.bind({
            cwd: project,
            projectPath: project,
            key: 'run',
            legacySettings: {},
          })
        ).binding
      ).toEqual(first.binding);
      available = false;
      await expect(
        restarted.bind({ cwd: project, projectPath: project, key: 'run', legacySettings: {} })
      ).rejects.toThrow();
    });
    it('stops PID 1 only after idle timeout, never while an active worker is present', async () => {
      let tick: (() => Promise<void>) | undefined;
      const exit = vi.fn();
      const kill = vi.fn();
      let now = 0;
      let names: string[] = [];
      const fixtureFs = {
        mkdir: async () => {},
        writeFile: async () => {},
        readdir: async () => names,
        stat: async () => ({ mtimeMs: now }),
        readFile: async () => JSON.stringify({ pid: 123 }),
        unlink: async () => {},
      };
      await vm.runInNewContext(DOCKER_INIT, {
        require: () => fixtureFs,
        Date: { now: () => now },
        process: { env: { HOME: '/tmp/home' }, exit, kill },
        setInterval: (callback: () => Promise<void>) => {
          tick = callback;
        },
      });
      for (let i = 0; i < 5; i++) await Promise.resolve();
      now = 900001;
      names = ['one.running'];
      await tick!();
      expect(exit).not.toHaveBeenCalled();
      expect(kill).toHaveBeenCalledWith(123, 0);
      names = [];
      now += 900001;
      await tick!();
      expect(exit).toHaveBeenCalledWith(0);
    });
  }
);
