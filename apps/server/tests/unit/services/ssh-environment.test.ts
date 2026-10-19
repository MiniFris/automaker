import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createPrivateKey } from 'node:crypto';
import { utils, type ParsedKey } from 'ssh2';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SSHEnvironmentProfile } from '@automaker/types';
import { toDirectModelId } from '@automaker/types';
import { SettingsService } from '@/services/settings-service.js';
import { ManagedSSH, SSHExecutionEnvironment } from '@/services/execution-environment/ssh.js';
import { EnvironmentBindingStore } from '@/services/execution-environment/bindings.js';
import { sshDigest } from '@/services/execution-environment/ssh-state.js';
import {
  prepareDirectExecution,
  runDirectShellCommand,
} from '@/providers/openai-compatible/execution.js';
import { ProviderFactory } from '@/providers/provider-factory.js';
import { AgentService } from '@/services/agent-service.js';
import { createEventEmitter } from '@/lib/events.js';
import { sshPeer, testSSHKey } from '../../helpers/ssh-peer.js';

const git = promisify(execFile);
describe.skipIf(process.platform !== 'linux')(
  'SSH environment against a real local SSH/SFTP peer',
  () => {
    let temporary: string,
      project: string,
      remote: string,
      key: string,
      profile: SSHEnvironmentProfile,
      settings: SettingsService,
      manager: ManagedSSH,
      peer: Awaited<ReturnType<typeof sshPeer>>;
    const active = () => new AbortController().signal;
    beforeEach(async () => {
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-environment-test-'));
      project = path.join(temporary, 'local-project');
      remote = path.join(temporary, "remote 'quoted");
      await fs.mkdir(project);
      await fs.mkdir(remote);
      key = testSSHKey();
      peer = await sshPeer(remote, key);
      profile = {
        id: 'ssh',
        name: 'Test SSH',
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
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await peer.close();
      await fs.rm(temporary, { recursive: true, force: true });
    });
    async function authorize() {
      const candidate = await manager.state.scan(profile);
      await manager.state.confirm(profile, candidate.fingerprint, false);
      await manager.state.saveKey('key', key);
      return candidate;
    }
    async function existing() {
      await authorize();
      const checkout = path.join(remote, 'checkout');
      await fs.mkdir(checkout);
      await git('git', ['-C', checkout, 'init', '-q']);
      await git('git', [
        '-C',
        checkout,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '--allow-empty',
        '-qm',
        'init',
      ]);
      return manager.prepareProject(
        profile,
        project,
        { method: 'existing', remotePath: checkout },
        active()
      );
    }
    it('inspects a public fingerprint without authentication and rejects execution before trust', async () => {
      const candidate = await manager.state.scan(profile);
      expect(candidate.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
      expect(peer.authentications).toBe(0);
      await expect(manager.prepareWorker(profile)).rejects.toMatchObject({
        code: 'SSH_TRUST_REQUIRED',
      });
      expect(peer.commands).toEqual([]);
    });
    it('requires the exact independently confirmed fingerprint and stores secrets only in private server state', async () => {
      await expect(
        manager.state.confirm(profile, 'SHA256:' + 'a'.repeat(43), false)
      ).rejects.toMatchObject({ code: 'SSH_HOST_KEY_CHANGED' });
      await authorize();
      const status = await manager.status(profile);
      expect(status.hasPrivateKey).toBe(true);
      expect(JSON.stringify(status)).not.toContain('PRIVATE KEY');
      expect(JSON.stringify(await settings.getGlobalSettings())).not.toContain(key);
      const file = path.join(
        settings.getDataDirectory(),
        'execution-environments',
        'ssh',
        'credentials',
        'key.json'
      );
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
      const publicKey = utils.parseKey(key) as ParsedKey;
      await expect(
        manager.state.saveKey(
          'key',
          `${publicKey.type} ${publicKey.getPublicSSH().toString('base64')}`
        )
      ).rejects.toMatchObject({ code: 'SSH_INVALID_KEY' });
      await manager.state.removeKey('key');
      await expect(manager.prepareWorker(profile)).rejects.toMatchObject({
        code: 'SSH_CREDENTIAL_REQUIRED',
      });
    });
    it('prepares a pinned versioned worker without copying a project during inspect/check', async () => {
      await authorize();
      expect((await manager.diagnose(profile)).worker).toBe('not-tested');
      await expect(fs.stat(profile.basePath)).rejects.toThrow();
      const worker = await manager.prepareWorker(profile);
      expect((await fs.stat(worker.workerPath)).mode & 0o777).toBe(0o600);
      expect((await manager.diagnose(profile)).worker).toBe('ready');
      await fs.appendFile(worker.workerPath, '\n// changed');
      await expect(manager.prepareWorker(profile)).rejects.toMatchObject({
        code: 'SSH_WORKER_CHANGED',
      });
    });
    it('authenticates with a passphrase-encrypted private key and rejects incorrect passphrases without replacing it', async () => {
      await authorize();
      const encrypted = createPrivateKey(key)
        .export({
          type: 'pkcs1',
          format: 'pem',
          cipher: 'aes-256-cbc',
          passphrase: 'fixture-passphrase',
        })
        .toString();
      await manager.state.saveKey('key', encrypted, 'fixture-passphrase');
      await expect(manager.state.saveKey('key', encrypted, 'wrong')).rejects.toMatchObject({
        code: 'SSH_INVALID_KEY',
      });
      expect((await manager.diagnose(profile)).status).toBe('available');
    });
    it(
      'pins remote cwd, creates remote run worktrees and never modifies the local control copy',
      { timeout: 20000 },
      async () => {
        const descriptor = await existing();
        const store = new EnvironmentBindingStore(settings);
        const first = await store.bind({
          cwd: project,
          projectPath: project,
          key: 'chat:a',
          legacySettings: {},
        });
        expect(first.binding.type).toBe('ssh');
        expect(first.binding.runtimeCwd).toContain(descriptor.remotePath + '/.worktrees/');
        const environment = new SSHExecutionEnvironment(
          manager,
          descriptor,
          first.binding.runtimeCwd!
        );
        await environment.writeFile('binary/data', Buffer.from([0, 128, 255]), active());
        expect((await environment.readFile('binary/data', 1, 2, active())).data).toEqual(
          Buffer.from([128, 255])
        );
        await expect(fs.stat(path.join(project, 'binary/data'))).rejects.toThrow();
        expect(
          (await environment.exec('git rev-parse --show-toplevel', active())).output.trim()
        ).toBe(environment.cwd);
        const second = await store.bind({
          cwd: project,
          projectPath: project,
          key: 'chat:b',
          legacySettings: {},
        });
        expect(second.binding.runtimeCwd).not.toBe(first.binding.runtimeCwd);
        await settings.updateGlobalSettings({
          executionEnvironment: { default: { mode: 'local' }, profiles: [] },
        });
        expect(
          (
            await new EnvironmentBindingStore(settings).bind({
              cwd: project,
              projectPath: project,
              key: 'chat:a',
              legacySettings: {},
            })
          ).binding
        ).toEqual(first.binding);
      }
    );
    it('uses remote binary/lookup/delete and bounded shell with cancellation and timeout effects', async () => {
      const descriptor = await existing();
      const environment = new SSHExecutionEnvironment(manager, descriptor, descriptor.remotePath);
      await environment.writeFile('src/read.txt', Buffer.from('Needle\nsecond'), active());
      expect(
        (
          await environment.search(
            { glob: '**/*.txt', text: 'needle', caseSensitive: false },
            active()
          )
        ).matches[0].line
      ).toBe(1);
      expect(
        await environment.exec('printf abcdef; exit 7', active(), { maxOutputBytes: 4 })
      ).toEqual({ exitCode: 7, output: 'abcd', truncated: true });
      await expect(
        environment.exec('printf effect > effect; sleep 20', active(), { timeoutMs: 100 })
      ).rejects.toMatchObject({ code: 'PROCESS_INTERRUPTED' });
      expect(await fs.readFile(path.join(descriptor.remotePath, 'effect'), 'utf8')).toBe('effect');
      await environment.remove('src', true, active());
      await expect(fs.stat(path.join(descriptor.remotePath, 'src'))).rejects.toThrow();
      const controller = new AbortController();
      const request = environment.exec(
        'printf ready > started; (sleep 1; printf leak > leaked) & wait',
        controller.signal
      );
      const assertion = expect(request).rejects.toThrow();
      for (let i = 0; i < 100; i++) {
        if (
          await fs.stat(path.join(descriptor.remotePath, 'started')).then(
            () => true,
            () => false
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      controller.abort();
      await assertion;
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await expect(fs.stat(path.join(descriptor.remotePath, 'leaked'))).rejects.toThrow();
      expect((await manager.status(profile, project)).project?.pendingOperations).toBe(0);
    }, 20000);
    it('transfers Git history and dirty/binary source once, committing the remote initial snapshot without push', async () => {
      await authorize();
      await git('git', ['-C', project, 'init', '-q']);
      await fs.writeFile(path.join(project, 'source.txt'), 'committed');
      await fs.writeFile(path.join(project, 'deleted.txt'), 'delete me');
      await git('git', ['-C', project, 'add', '.']);
      await git('git', [
        '-C',
        project,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-qm',
        'source',
      ]);
      await fs.writeFile(path.join(project, 'source.txt'), 'dirty');
      await fs.unlink(path.join(project, 'deleted.txt'));
      await fs.writeFile(path.join(project, 'binary.bin'), Buffer.from([0, 255]));
      await fs.mkdir(path.join(project, 'node_modules'));
      await fs.writeFile(path.join(project, 'node_modules', 'excluded'), 'dependency');
      const descriptor = await manager.prepareProject(
        profile,
        project,
        { method: 'import' },
        active()
      );
      expect(await fs.readFile(path.join(descriptor.remotePath, 'source.txt'), 'utf8')).toBe(
        'dirty'
      );
      await expect(fs.stat(path.join(descriptor.remotePath, 'deleted.txt'))).rejects.toThrow();
      expect(await fs.readFile(path.join(descriptor.remotePath, 'binary.bin'))).toEqual(
        Buffer.from([0, 255])
      );
      await expect(fs.stat(path.join(descriptor.remotePath, 'node_modules'))).rejects.toThrow();
      const bound = await manager.bind(profile, project, 'chat:import', '');
      const environment = new SSHExecutionEnvironment(manager, descriptor, bound.runtimeCwd);
      expect((await environment.readFile('source.txt', 0, 100, active())).data.toString()).toBe(
        'dirty'
      );
      expect((await environment.exec('git rev-list --count HEAD', active())).output.trim()).toBe(
        '2'
      );
      expect(peer.commands.join(' ')).not.toContain('git push');
      expect((await git('git', ['-C', project, 'rev-list', '--count', 'HEAD'])).stdout.trim()).toBe(
        '1'
      );
    }, 20000);
    it('keeps unknown results blocked across restart, recovers without command replay, and records no command contents', async () => {
      const descriptor = await existing();
      const environment = new SSHExecutionEnvironment(manager, descriptor, descriptor.remotePath);
      const original = manager.run.bind(manager);
      let dropped = false;
      vi.spyOn(manager, 'run').mockImplementation(async (...args) => {
        const result = await original(...args);
        if (
          !dropped &&
          typeof args[3]?.input === 'string' &&
          JSON.parse(args[3].input).operation === 'exec'
        ) {
          dropped = true;
          throw new (
            await import('@/services/execution-environment/ssh-transport.js')
          ).SSHTransportError('SSH_OUTCOME_UNKNOWN', 'fixture disconnect', true);
        }
        return result;
      });
      await expect(environment.exec('printf once >> effect', active())).rejects.toMatchObject({
        code: 'SSH_OUTCOME_UNKNOWN',
      });
      const restarted = new ManagedSSH(settings);
      await expect(restarted.verify(descriptor)).rejects.toMatchObject({
        code: 'SSH_OUTCOME_UNKNOWN',
      });
      const directory = path.join(
        settings.getDataDirectory(),
        'execution-environments',
        'ssh',
        'jobs',
        manager.state.projectKey(profile, descriptor.fingerprint, project)
      );
      const journals = await fs.readdir(directory);
      const data = await fs.readFile(
        path.join(directory, journals.find((name) => name.endsWith('.json'))!),
        'utf8'
      );
      expect(data).not.toContain('printf once');
      await restarted.recover(descriptor);
      expect(await fs.readFile(path.join(descriptor.remotePath, 'effect'), 'utf8')).toBe('once');
      await restarted.verify(descriptor);
    }, 20000);
    it('refuses host key changes and never automatically retargets pinned bindings', async () => {
      const descriptor = await existing();
      const port = peer.port;
      await peer.close();
      peer = await sshPeer(remote, key, testSSHKey(), port);
      expect((await manager.diagnose(profile)).status).toBe('host-key-changed');
      expect(peer.authentications).toBe(0);
      await expect(manager.verify(descriptor)).rejects.toMatchObject({
        code: 'SSH_HOST_KEY_CHANGED',
      });
      const candidate = await manager.state.scan(profile);
      await expect(manager.state.confirm(profile, candidate.fingerprint, false)).rejects.toThrow(
        'replacement'
      );
      await manager.state.confirm(profile, candidate.fingerprint, true);
      await expect(manager.verify(descriptor)).rejects.toMatchObject({
        code: 'SSH_HOST_KEY_CHANGED',
      });
    });
    it('does not infer a remote checkout from a local path or start copying on first model use', async () => {
      await authorize();
      const store = new EnvironmentBindingStore(settings);
      await expect(
        store.bind({ cwd: project, projectPath: project, key: 'chat:new', legacySettings: {} })
      ).rejects.toMatchObject({ code: 'SSH_PROJECT_REQUIRED' });
      expect(peer.commands).toEqual([]);
      expect(sshDigest('stable')).toHaveLength(64);
    });
    it.skipIf(
      !!spawnSync('ssh-agent', ['-V'], { stdio: 'ignore' }).error ||
        !!spawnSync('ssh-add', ['-l'], { stdio: 'ignore' }).error
    )(
      'authenticates with the backend ssh-agent without forwarding it to the remote process',
      { timeout: 15000 },
      async () => {
        const socket = path.join(temporary, 'agent.sock');
        const agent = spawn('ssh-agent', ['-D', '-a', socket], { stdio: 'ignore' });
        const exited = once(agent, 'exit');
        try {
          for (let i = 0; i < 200; i++) {
            if (
              await fs.stat(socket).then(
                () => true,
                () => false
              )
            )
              break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          const file = path.join(temporary, 'agent-key');
          await fs.writeFile(file, key, { mode: 0o600 });
          await git('ssh-add', [file], { env: { ...process.env, SSH_AUTH_SOCK: socket } });
          vi.stubEnv('SSH_AUTH_SOCK', socket);
          const candidate = await manager.state.scan(profile);
          await manager.state.confirm(profile, candidate.fingerprint, false);
          const agentProfile = { ...profile, credentialId: undefined };
          expect((await manager.diagnose(agentProfile)).status).toBe('available');
          const result = await manager.run(
            agentProfile,
            candidate.fingerprint,
            'test -z "$SSH_AUTH_SOCK"'
          );
          expect(result.code).toBe(0);
        } finally {
          agent.kill('SIGTERM');
          await exited;
        }
      }
    );
    it('rejects secret-bearing clone URLs before creating any remote worker or staging directory', async () => {
      for (const repositoryUrl of [
        'https://token@example.com/repo',
        'ssh://git:password@example.com/repo',
        'https://example.com/repo?token=secret',
        'file:///tmp/repo',
        'bad',
      ])
        await expect(
          manager.prepareProject(profile, project, { method: 'clone', repositoryUrl }, active())
        ).rejects.toMatchObject({ code: 'SSH_INVALID_REPOSITORY' });
      expect(peer.commands).toEqual([]);
    });
    it(
      'records an actual SSH channel loss and cancels the remote child without retrying its effects',
      { timeout: 20000 },
      async () => {
        const descriptor = await existing();
        const environment = new SSHExecutionEnvironment(manager, descriptor, descriptor.remotePath);
        const request = environment.exec('printf once >> once; sleep 20', active());
        const rejected = expect(request).rejects.toMatchObject({ code: 'SSH_OUTCOME_UNKNOWN' });
        for (let i = 0; i < 300; i++) {
          if (
            await fs.stat(path.join(descriptor.remotePath, 'once')).then(
              () => true,
              () => false
            )
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        peer.disconnect();
        await rejected;
        expect((await manager.status(profile, project)).project?.pendingOperations).toBe(1);
        await manager.recover(descriptor);
        expect(await fs.readFile(path.join(descriptor.remotePath, 'once'), 'utf8')).toBe('once');
      }
    );
    it(
      'runs Direct chat/model tools and pipeline commands remotely, preserving the chat binding after restart',
      { timeout: 30000 },
      async () => {
        vi.stubEnv('AUTOMAKER_MOCK_AGENT', 'false');
        const descriptor = await existing();
        const targetMemory = path.join(
          descriptor.remotePath,
          '.automaker',
          'memory',
          'architecture.md'
        );
        await fs.mkdir(path.dirname(targetMemory), { recursive: true });
        await fs.writeFile(targetMemory, '# Remote memory\n\nRemote immutable workspace bindings');
        const controllerMemory = path.join(project, '.automaker', 'memory', 'architecture.md');
        await fs.mkdir(path.dirname(controllerMemory), { recursive: true });
        await fs.writeFile(controllerMemory, 'STALE_CONTROLLER_MEMORY_MUST_NOT_CHANGE');
        await fs.mkdir(path.join(project, '.automaker', 'context'), { recursive: true });
        await fs.writeFile(
          path.join(project, '.automaker', 'context', 'CLAUDE.md'),
          'STALE_LOCAL_INSTRUCTIONS_MUST_NOT_LEAK'
        );
        const bodies: Array<{
          messages: Array<{ role: string; content: unknown }>;
          tools?: Array<{ function: { name: string } }>;
        }> = [];
        const modelServer = createServer((request, response) => {
          void (async () => {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            bodies.push(JSON.parse(Buffer.concat(chunks).toString()));
            const call = (name: string, args: object) => ({
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: `call-${bodies.length}`,
                  type: 'function',
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            });
            const message =
              bodies.length === 1
                ? call('Write', { path: 'data.bin', content: 'AP8=', encoding: 'base64' })
                : bodies.length === 2
                  ? call('Bash', {
                      command: 'test -f data.bin && printf 42 > result.txt && rm data.bin',
                    })
                  : bodies.length === 3
                    ? call('Read', { path: 'result.txt' })
                    : {
                        role: 'assistant',
                        content: 'Remote immutable workspace bindings done remotely',
                      };
            response.setHeader('Content-Type', 'application/json');
            response.end(
              JSON.stringify({
                choices: [
                  { index: 0, message, finish_reason: bodies.length < 4 ? 'tool_calls' : 'stop' },
                ],
              })
            );
          })().catch(() => {
            response.statusCode = 500;
            response.end();
          });
        });
        modelServer.listen(0, '127.0.0.1');
        await once(modelServer, 'listening');
        const model = toDirectModelId('remote-model');
        await settings.updateGlobalSettings({
          openaiCompatibleEndpoints: [
            {
              id: 'model',
              name: 'Model',
              enabled: true,
              baseUrl: `http://127.0.0.1:${(modelServer.address() as { port: number }).port}/v1`,
              protocol: 'chat-completions',
              auth: { type: 'none' },
              models: [
                {
                  id: 'remote-model',
                  displayName: 'Remote',
                  capabilities: { tools: true, streaming: false },
                },
              ],
            },
          ],
        });
        try {
          const service = new AgentService(
            settings.getDataDirectory(),
            createEventEmitter(),
            settings
          );
          await service.initialize();
          const session = await service.createSession('SSH', project, project, model, 'model');
          expect(
            (await service.sendMessage({ sessionId: session.id, message: 'Work remotely' })).success
          ).toBe(true);
          const binding = (await service.listSessions()).find(
            (item) => item.id === session.id
          )!.executionEnvironment!;
          expect(binding.type).toBe('ssh');
          expect(binding.runtimeCwd).toContain(descriptor.remotePath);
          expect(await fs.readFile(path.join(binding.runtimeCwd!, 'result.txt'), 'utf8')).toBe(
            '42'
          );
          await expect(fs.stat(path.join(project, 'result.txt'))).rejects.toThrow();
          expect(JSON.stringify(bodies)).not.toContain('STALE_LOCAL_INSTRUCTIONS_MUST_NOT_LEAK');
          expect(JSON.stringify(bodies)).not.toContain('STALE_CONTROLLER_MEMORY_MUST_NOT_CHANGE');
          expect(JSON.stringify(bodies[0].messages)).toContain(
            'Remote immutable workspace bindings'
          );
          expect(await fs.readFile(targetMemory, 'utf8')).toContain('loaded: 1');
          expect(await fs.readFile(targetMemory, 'utf8')).toContain('referenced: 1');
          expect(await fs.readFile(targetMemory, 'utf8')).toContain('successfulFeatures: 1');
          expect(JSON.stringify(bodies[0].messages)).toContain('authoritative working directory');
          expect(JSON.stringify(bodies[3].messages)).toContain('42');
          const result = await runDirectShellCommand(
            settings,
            project,
            'test "$(cat result.txt)" = 42',
            active(),
            { projectPath: project, runKey: `chat:${session.id}` }
          );
          expect(result.exitCode).toBe(0);
          await settings.updateGlobalSettings({
            executionEnvironment: { default: { mode: 'local' }, profiles: [] },
          });
          const restarted = new AgentService(
            settings.getDataDirectory(),
            createEventEmitter(),
            settings
          );
          await restarted.initialize();
          expect(
            (await restarted.sendMessage({ sessionId: session.id, message: 'Continue remotely' }))
              .success
          ).toBe(true);
          expect(
            (await restarted.listSessions()).find((item) => item.id === session.id)!
              .executionEnvironment
          ).toEqual(binding);
          expect(await fs.readFile(targetMemory, 'utf8')).toContain('loaded: 2');
          expect(await fs.readFile(targetMemory, 'utf8')).toContain('successfulFeatures: 2');
          expect(await fs.readFile(controllerMemory, 'utf8')).toBe(
            'STALE_CONTROLLER_MEMORY_MUST_NOT_CHANGE'
          );
          const prepared = await prepareDirectExecution(
            { cwd: project, prompt: 'Plan', model: 'remote-model', readOnly: true },
            settings,
            { model, providerId: 'model', projectPath: project, runKey: `chat:${session.id}` }
          );
          for await (const _message of ProviderFactory.getProviderForModel(model).executeQuery(
            prepared
          )) {
            /* drain */
          }
          expect(bodies.at(-1)!.tools?.map((tool) => tool.function.name)).toEqual([
            'Read',
            'LS',
            'Glob',
            'Grep',
            'TodoWrite',
          ]);
          await manager.state.removeKey('key');
          await expect(
            prepareDirectExecution(
              { cwd: project, prompt: 'Fail', model: 'remote-model' },
              settings,
              { model, providerId: 'model', projectPath: project, runKey: `chat:${session.id}` }
            )
          ).rejects.toThrow('private key');
          expect(bodies).toHaveLength(6);
        } finally {
          modelServer.closeAllConnections();
          await new Promise<void>((resolve) => modelServer.close(() => resolve()));
        }
      }
    );
  }
);
