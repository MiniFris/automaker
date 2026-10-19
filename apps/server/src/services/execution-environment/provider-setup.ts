import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { RemoteSdkProvider, RemoteProviderStatus } from '@automaker/types';
import type { SettingsService } from '../settings-service.js';
import { EnvironmentBindingStore } from './bindings.js';
import { ManagedDocker, DockerExecutionEnvironment } from './docker.js';
import { ManagedSSH, SSHExecutionEnvironment } from './ssh.js';
import { ExecutionEnvironmentError, type ExecutionEnvironment } from './runtime.js';
import { PROVIDER_ADMIN, providerManifest } from './provider-catalog.js';

export class ProviderSetupService {
  constructor(
    private readonly settings: SettingsService,
    private readonly docker = new ManagedDocker(settings),
    private readonly ssh = new ManagedSSH(settings)
  ) {}
  private async target(projectPath: string, signal: AbortSignal) {
    projectPath = await fs.realpath(projectPath);
    const state = await new EnvironmentBindingStore(this.settings).configuration(projectPath);
    let runtime: ExecutionEnvironment, identity: unknown;
    if (state.resolved.type === 'ssh' && state.resolved.profile?.type === 'ssh') {
      const profile = state.resolved.profile;
      const trusted = await this.ssh.state.trust(profile);
      const descriptor = trusted
        ? await this.ssh.state.project(profile, trusted.fingerprint, projectPath)
        : undefined;
      if (!descriptor?.ready)
        throw new ExecutionEnvironmentError(
          'SSH_PROJECT_REQUIRED',
          'Prepare the saved SSH project before configuring its providers.'
        );
      const binding = { ...descriptor, profile };
      await this.ssh.verify(binding, signal);
      runtime = new SSHExecutionEnvironment(this.ssh, binding, binding.remotePath);
      identity = [profile, trusted!.fingerprint, binding.remotePath, binding.identity];
    } else if (state.resolved.type === 'docker' || state.resolved.type === 'auto') {
      const context =
        state.resolved.profile?.type === 'docker' ? state.resolved.profile.context : undefined;
      const binding = await this.docker.existing(projectPath, context);
      if (!binding)
        throw new ExecutionEnvironmentError(
          'DOCKER_PROJECT_REQUIRED',
          'Prepare the saved Docker project before configuring its providers. Auto setup never falls back to Local.'
        );
      await this.docker.start(binding, signal);
      runtime = new DockerExecutionEnvironment(this.docker, binding, projectPath);
      identity = [binding, state.resolved.selection];
    } else
      throw new ExecutionEnvironmentError(
        'PROVIDER_TARGET_REQUIRED',
        'Provider setup requires a saved Docker/Auto or SSH project target. Local providers use their existing settings.'
      );
    return {
      runtime,
      targetId: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
    };
  }
  async run(
    projectPath: string,
    provider: RemoteSdkProvider,
    operation: 'inspect' | 'install' | 'key',
    signal: AbortSignal,
    controls?: { targetId: string; apiKey?: string; clear?: boolean }
  ): Promise<RemoteProviderStatus> {
    const { runtime, targetId } = await this.target(projectPath, signal);
    if (operation !== 'inspect' && controls?.targetId !== targetId)
      throw new ExecutionEnvironmentError(
        'PROVIDER_TARGET_CHANGED',
        'The saved execution target changed. Inspect the target again before installation or saving credentials.'
      );
    const chunks: Buffer[] = [];
    let bytes = 0;
    const result = await runtime.runProcess!(
      {
        command: 'node',
        args: ['-e', PROVIDER_ADMIN],
        stdin: JSON.stringify({
          manifest: providerManifest(provider),
          operation,
          ...(operation === 'key' && { apiKey: controls?.apiKey, clear: controls?.clear }),
        }),
        timeoutMs: 600_000,
        idleTimeoutMs: 600_000,
      },
      signal,
      (stream, data) => {
        if (stream !== 'stdout') return;
        bytes += data.length;
        if (bytes > 65_536)
          throw new ExecutionEnvironmentError(
            'PROVIDER_SETUP_FAILED',
            'Invalid target provider setup response.'
          );
        chunks.push(data);
      }
    );
    const response = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      ok: boolean;
      status: Omit<RemoteProviderStatus, 'provider' | 'targetId' | 'environment' | 'cwd'>;
    };
    if (result.exitCode !== 0 || !response.ok)
      throw new ExecutionEnvironmentError(
        'PROVIDER_SETUP_FAILED',
        'Target SDK setup failed. Check npm/registry access, disk, ownership and private credential file permissions. No Local fallback was performed.'
      );
    return {
      provider,
      targetId,
      environment: runtime.type as 'docker' | 'ssh',
      cwd: runtime.cwd,
      ...response.status,
    };
  }
}
