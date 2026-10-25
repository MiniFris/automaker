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
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  stripProviderPrefix,
  type RemoteSdkProvider,
  type SSHEnvironmentProfile,
} from '@automaker/types';
import { SettingsService } from '@/services/settings-service.js';
import { ManagedSSH } from '@/services/execution-environment/ssh.js';
import { ProviderSetupService } from '@/services/execution-environment/provider-setup.js';
import { providerManifest } from '@/services/execution-environment/provider-catalog.js';
import { prepareDirectExecution } from '@/providers/openai-compatible/execution.js';
import { AgentService } from '@/services/agent-service.js';
import { AutoModeServiceFacade } from '@/services/auto-mode/facade.js';
import { FeatureLoader } from '@/services/feature-loader.js';
import { createEventEmitter } from '@/lib/events.js';
import { sshPeer, testSSHKey } from '../../helpers/ssh-peer.js';
import { sdkInstallerFixture, useActualSDK } from '../../helpers/remote-sdk-fixture.js';

const exec = promisify(execFile),
  active = () => new AbortController().signal;
describe.skipIf(process.platform !== 'linux')('target-side SDK setup and execution', () => {
  let temporary: string,
    project: string,
    remote: string,
    checkout: string,
    settings: SettingsService,
    manager: ManagedSSH,
    setup: ProviderSetupService,
    profile: SSHEnvironmentProfile,
    peer: Awaited<ReturnType<typeof sshPeer>>;
  const models = { claude: 'sonnet', codex: 'codex-gpt-5', copilot: 'copilot-gpt-5' };
  beforeEach(async () => {
    vi.stubEnv('AUTOMAKER_MOCK_AGENT', 'false');
    vi.stubEnv('AUTOMAKER_API_KEY', 'CONTROLLER_ONLY');
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-sdk-test-'));
    project = path.join(temporary, 'controller');
    remote = path.join(temporary, "remote 'quoted");
    checkout = path.join(remote, 'checkout');
    await fs.mkdir(project);
    await fs.mkdir(checkout, { recursive: true });
    await fs.writeFile(path.join(project, 'AGENTS.md'), 'STALE_CONTROLLER_INSTRUCTIONS');
    await fs.writeFile(path.join(checkout, 'AGENTS.md'), 'REMOTE_INSTRUCTIONS');
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
    await sdkInstallerFixture(remote);
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
      name: 'Target',
      type: 'ssh',
      host: '127.0.0.1',
      port: peer.port,
      username: 'developer',
      basePath: path.join(remote, 'projects'),
      credentialId: 'key',
    };
    settings = new SettingsService(path.join(temporary, 'data'));
    manager = new ManagedSSH(settings);
    setup = new ProviderSetupService(settings, undefined, manager);
    await settings.updateGlobalSettings({
      executionEnvironment: { default: { mode: 'profile', profileId: 'ssh' }, profiles: [profile] },
    });
    const trust = await manager.state.scan(profile);
    await manager.state.confirm(profile, trust.fingerprint, false);
    await manager.state.saveKey('key', key);
    await manager.prepareProject(
      profile,
      project,
      { method: 'existing', remotePath: checkout },
      active()
    );
  }, 15000);
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await peer.close();
    await fs.rm(temporary, { recursive: true, force: true });
  });
  async function install(provider: RemoteSdkProvider) {
    const initial = await setup.run(project, provider, 'inspect', active());
    const status = await setup.run(project, provider, 'install', active(), {
      targetId: initial.targetId,
    });
    await setup.run(project, provider, 'key', active(), {
      targetId: status.targetId,
      apiKey: 'target-fixture-key',
    });
    return status;
  }
  it.each(['claude', 'codex', 'copilot'] as const)(
    'runs the real installed %s SDK through a fixture CLI protocol, without model/network calls',
    async (provider) => {
      const status = await install(provider);
      await useActualSDK(status.root, provider);
      const model = models[provider];
      const options = await prepareDirectExecution(
        {
          prompt: 'actual protocol prompt',
          model: stripProviderPrefix(model),
          cwd: project,
          readOnly: provider !== 'copilot',
        },
        settings,
        { model, projectPath: project, runKey: 'chat:actual' }
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
        session_id:
          provider === 'copilot'
            ? await fs.readFile(path.join(options.cwd, 'actual-sdk-session-id.txt'), 'utf8')
            : `${provider}-actual-session`,
      });
      expect(JSON.stringify(messages)).toContain('Actual installed SDK protocol completed');
      expect(await fs.readFile(path.join(options.cwd, 'actual-sdk-result.txt'), 'utf8')).toContain(
        'actual protocol prompt'
      );
      const invocation = JSON.parse(
        await fs.readFile(path.join(options.cwd, 'actual-sdk-invocation.json'), 'utf8')
      );
      expect(invocation).toMatchObject({ home: remote, hasTargetKey: true });
      if (provider === 'claude') {
        expect(invocation.args).toContain('--tools');
        expect(invocation.args.join(' ')).toContain('Read,Glob,Grep');
        expect(invocation.args).not.toContain('--dangerously-skip-permissions');
      }
      if (provider === 'codex') {
        expect(invocation.args).toContain('--sandbox');
        expect(invocation.args).toContain('read-only');
      }
    },
    30000
  );
  it('inspects without installation/worktrees and installs only pinned target packages in a private prefix', async () => {
    const before = await setup.run(project, 'codex', 'inspect', active());
    expect(before).toMatchObject({ installed: false, credentialSource: 'not-detected' });
    await expect(fs.stat(path.join(remote, 'npm-argv.json'))).rejects.toThrow();
    await expect(fs.stat(path.join(checkout, '.worktrees'))).rejects.toThrow();
    const status = await install('codex');
    expect(status.installed).toBe(true);
    const args = JSON.parse(await fs.readFile(path.join(remote, 'npm-argv.json'), 'utf8'));
    expect(args).toEqual([
      'install',
      '--prefix',
      status.root,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--registry=https://registry.npmjs.org',
    ]);
    const packageJson = JSON.parse(
      await fs.readFile(path.join(status.root, 'package.json'), 'utf8')
    );
    expect(packageJson.dependencies).toEqual(providerManifest('codex').dependencies);
    expect((await fs.stat(path.join(status.root, 'credentials.json'))).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(await settings.getGlobalSettings())).not.toContain('target-fixture-key');
    expect(JSON.stringify(await settings.getCredentials())).not.toContain('target-fixture-key');
    expect(peer.commands.join(' ')).not.toContain('target-fixture-key');
    expect((await setup.run(project, 'codex', 'inspect', active())).authentication).toBe(
      'configured-unverified'
    );
    await setup.run(project, 'codex', 'key', active(), { targetId: status.targetId, clear: true });
    expect((await setup.run(project, 'codex', 'inspect', active())).hasStoredKey).toBe(false);
  }, 20000);
  it.each(['claude', 'codex', 'copilot'] as const)(
    'streams %s SDK messages from the target with separate credentials and no host source writes',
    async (provider) => {
      await install(provider);
      const model = models[provider];
      const options = await prepareDirectExecution(
        { prompt: 'literal $(touch leaked)', model: stripProviderPrefix(model), cwd: project },
        settings,
        { model, projectPath: project, runKey: 'chat:sdk' }
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
        subtype: 'success',
        session_id: `${provider}-session`,
      });
      expect(messages.some((message) => message.type === 'assistant')).toBe(true);
      expect(await fs.readFile(path.join(options.cwd, 'sdk-result.txt'), 'utf8')).toBe(
        'remote-only'
      );
      await expect(fs.stat(path.join(project, 'sdk-result.txt'))).rejects.toThrow();
      await expect(fs.stat(path.join(options.cwd, 'leaked'))).rejects.toThrow();
      expect(
        await fs.readFile(path.join(options.cwd, 'sdk-invocation.json'), 'utf8')
      ).not.toContain('target-fixture-key');
      if (provider === 'copilot')
        expect(await fs.readFile(path.join(options.cwd, 'sdk-client-cleaned'), 'utf8')).toBe(
          'done'
        );
    },
    20000
  );
  it('uses real chat and preserves the SDK/runtime session across restart and default changes', async () => {
    await install('claude');
    const service = new AgentService(
      ...createTestAgentState(
        settings.getDataDirectory(),
        createTestAgentEvents(createEventEmitter())
      ),
      settings,
      ...createTestAgentProviders(createTestProviderRegistry(settings))
    );
    await service.initialize();
    const session = await service.createSession('Remote SDK', project, project, 'sonnet');
    expect(
      (await service.sendMessage({ sessionId: session.id, message: 'Implement' })).success
    ).toBe(true);
    const binding = (await service.listSessions())[0].executionEnvironment!;
    expect(
      await fs.readFile(path.join(binding.runtimeCwd!, 'sdk-invocation.json'), 'utf8')
    ).not.toContain('STALE_CONTROLLER_INSTRUCTIONS');
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
    expect((await restarted.listSessions())[0].executionEnvironment).toEqual(binding);
    expect(
      await fs.readFile(path.join(binding.runtimeCwd!, 'sdk-invocation.json'), 'utf8')
    ).toContain('claude-session');
  }, 25000);
  it('runs the real SDK Kanban facade, remote context and commit/merge', async () => {
    await install('codex');
    const loader = new FeatureLoader();
    const feature = await loader.create(project, {
      id: 'sdk-feature',
      category: 'Test',
      title: 'SDK feature',
      description: 'Implement remotely',
      model: models.codex,
      branchName: 'main',
      status: 'ready',
      planningMode: 'skip',
      skipTests: true,
    });
    const facade = AutoModeServiceFacade.create(project, {
      filesystem: executionFilesystem,
      pipeline: new PipelineService(),
      providerRegistry: createTestProviderRegistry(settings),
      events: createEventEmitter(),
      settingsService: settings,
      featureLoader: loader,
    });
    await facade.executeFeature(feature.id, true, false);
    expect((await loader.get(project, feature.id))!.status).toBe('waiting_approval');
    await facade.commitFeature(feature.id);
    await facade.mergeSSHFeature(feature.id);
    expect(await fs.readFile(path.join(checkout, 'sdk-result.txt'), 'utf8')).toBe('remote-only');
    expect(await fs.readFile(path.join(checkout, 'sdk-invocation.json'), 'utf8')).toContain(
      'REMOTE_INSTRUCTIONS'
    );
    await expect(fs.stat(path.join(project, '.git'))).rejects.toThrow();
  }, 30000);
  it.each(['claude', 'codex'] as const)(
    'enforces %s read-only planning with target SDK controls',
    async (provider) => {
      await install(provider);
      const model = models[provider];
      const options = await prepareDirectExecution(
        { prompt: 'Plan only', model: stripProviderPrefix(model), cwd: project, readOnly: true },
        settings,
        { model, projectPath: project, runKey: 'chat:plan' }
      );
      for await (const _message of createTestProviderRegistry(settings)
        .providerForModel(model, {
          throwOnDisconnected: false,
        })
        .executeQuery(options)) {
        /* drain */
      }
      const invocation = JSON.parse(
        await fs.readFile(path.join(options.cwd, 'sdk-invocation.json'), 'utf8')
      );
      if (provider === 'claude')
        expect(invocation.settings).toMatchObject({
          tools: ['Read', 'Glob', 'Grep'],
          readOnly: true,
          strictMcpConfig: true,
        });
      else
        expect(invocation.settings).toMatchObject({
          sandboxMode: 'read-only',
          approvalPolicy: 'never',
          networkAccessEnabled: false,
        });
      await expect(fs.stat(path.join(options.cwd, 'sdk-result.txt'))).rejects.toThrow();
    },
    20000
  );
  it('fails closed when absent, rejects target changes, redacts errors and never replays a failed resume', async () => {
    const model = models.codex;
    let options = await prepareDirectExecution(
      { prompt: 'Implement', model: 'gpt-5', cwd: project },
      settings,
      { model, projectPath: project, runKey: 'chat:failure' }
    );
    await expect(
      createTestProviderRegistry(settings)
        .providerForModel(model, { throwOnDisconnected: false })
        .executeQuery(options)
        .next()
    ).rejects.toMatchObject({ code: 'REMOTE_SDK_NOT_INSTALLED' });
    const initial = await setup.run(project, 'codex', 'inspect', active());
    await expect(
      setup.run(project, 'codex', 'install', active(), { targetId: '0'.repeat(64) })
    ).rejects.toMatchObject({ code: 'PROVIDER_TARGET_CHANGED' });
    expect(initial.installed).toBe(false);
    await install('codex');
    options = { ...options, prompt: 'FAIL' };
    await expect(
      createTestProviderRegistry(settings)
        .providerForModel(model, { throwOnDisconnected: false })
        .executeQuery(options)
        .next()
    ).rejects.toThrow('[REDACTED]');
    options = { ...options, prompt: 'Continue', sdkSessionId: 'missing-session' };
    await expect(
      createTestProviderRegistry(settings)
        .providerForModel(model, { throwOnDisconnected: false })
        .executeQuery(options)
        .next()
    ).rejects.toThrow('Session not found');
  }, 30000);
});
