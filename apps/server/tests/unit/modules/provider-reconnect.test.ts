import fs from 'node:fs';
import { mkdtemp, readdir, rm, symlink, writeFile, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { CliConnectionProviderSchema } from '@automaker/contracts';
import { ProviderConnectionRepository } from '../../../src/modules/providers/provider-connection.repository.js';
import { ProviderConnectionCommandService } from '../../../src/modules/providers/provider-connection-command.service.js';

let directory: string;
let repository: ProviderConnectionRepository;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-provider-reconnect-'));
  repository = ProviderConnectionRepository.forWorkingDirectory(directory);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
const fixture = () => {
  const runtime = {
    claudeIndicators: vi.fn().mockResolvedValue({ hasCredentialsFile: false }),
    codexIndicators: vi
      .fn()
      .mockResolvedValue({ hasApiKey: false, hasAuthFile: false, hasOAuthToken: false }),
    cursorCredentials: vi.fn().mockResolvedValue(false),
  };
  const configured = vi.fn().mockReturnValue(false);
  return {
    runtime,
    configured,
    service: new ProviderConnectionCommandService(
      repository,
      runtime as never,
      { providers: { isEnvironmentVariableConfigured: configured } } as never
    ),
  };
};
describe('native provider reconnect', () => {
  it.each(CliConnectionProviderSchema.options)(
    'removes only the selected %s marker and remains idempotent',
    async (name) => {
      await repository.disconnect(name);
      const other = name === 'claude' ? 'codex' : 'claude';
      await repository.disconnect(other);
      await repository.reconnect(name);
      await repository.reconnect(name);
      expect(repository.isDisconnected(name)).toBe(false);
      expect(repository.isDisconnected(other)).toBe(true);
    }
  );
  it('does not create any files when already connected', async () => {
    await repository.reconnect('claude');
    expect(await readdir(directory)).toEqual([]);
  });
  it('does not report reconnect success when unlink fails', async () => {
    await repository.disconnect('claude');
    const remove = vi
      .spyOn(fs.promises, 'unlink')
      .mockRejectedValueOnce(new Error('private unlink error'));
    await expect(repository.reconnect('claude')).rejects.toThrow(
      'Provider connection state could not be saved.'
    );
    expect(repository.isDisconnected('claude')).toBe(true);
    remove.mockRestore();
    await repository.reconnect('claude');
    expect(repository.isDisconnected('claude')).toBe(false);
  });
  it.skipIf(process.platform === 'win32')(
    'does not remove a marker symlink or its target',
    async () => {
      await mkdir(path.join(directory, '.automaker'));
      const protectedFile = path.join(directory, 'preserve');
      await writeFile(protectedFile, 'protected');
      await symlink(protectedFile, path.join(directory, '.automaker', '.claude-disconnected'));
      await expect(repository.reconnect('claude')).rejects.toMatchObject({ statusCode: 503 });
      expect(await readFile(protectedFile, 'utf8')).toBe('protected');
    }
  );
  it.skipIf(process.platform === 'win32')(
    'does not remove a marker through a directory symlink',
    async () => {
      const linked = path.join(directory, 'elsewhere');
      await mkdir(linked);
      await writeFile(path.join(linked, '.claude-disconnected'), 'preserve');
      await symlink(linked, path.join(directory, '.automaker'));
      await expect(repository.reconnect('claude')).rejects.toMatchObject({ statusCode: 503 });
      expect(await readFile(path.join(linked, '.claude-disconnected'), 'utf8')).toBe('preserve');
    }
  );
  it.each(CliConnectionProviderSchema.options)(
    'requires confirmation of %s and returns actual connection/evidence',
    async (provider) => {
      await repository.disconnect(provider);
      const { service } = fixture();
      const target = service.target(provider).target;
      await expect(
        service.reconnect(provider, { confirmed: false, target } as never)
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(repository.isDisconnected(provider)).toBe(true);
      const response = await service.reconnect(provider, { confirmed: true, target });
      expect(response).toMatchObject({
        success: true,
        connected: true,
        target,
        credentialStatus: ['gemini', 'copilot'].includes(provider)
          ? 'not-inspected'
          : 'not-detected',
      });
      expect(repository.isDisconnected(provider)).toBe(false);
      expect(response.wasAlreadyAuthenticated).toBeUndefined();
      if (!['gemini', 'copilot'].includes(provider)) expect(response.requiresManualAuth).toBe(true);
    }
  );
  it.each(['claude', 'codex', 'cursor', 'opencode'] as const)(
    'preserves %s evidence without claiming live verification',
    async (provider) => {
      const { service, runtime, configured } = fixture();
      runtime.claudeIndicators.mockResolvedValue({ hasCredentialsFile: true });
      runtime.codexIndicators.mockResolvedValue({
        hasApiKey: false,
        hasAuthFile: true,
        hasOAuthToken: true,
      });
      runtime.cursorCredentials.mockResolvedValue(true);
      configured.mockReturnValue(true);
      const response = await service.reconnect(provider, {
        confirmed: true,
        target: service.target(provider).target,
      });
      expect(response).toMatchObject({
        connected: true,
        credentialStatus: 'present-unverified',
        wasAlreadyAuthenticated: true,
      });
      expect(response.requiresManualAuth).toBeUndefined();
      if (provider === 'cursor') expect(runtime.cursorCredentials).not.toHaveBeenCalled();
    }
  );
  it('refuses a stale target before reading credentials or mutating state', async () => {
    await repository.disconnect('claude');
    const { service, runtime } = fixture();
    const target = service.target('claude').target;
    await expect(
      service.reconnect('claude', {
        confirmed: true,
        target: { ...target, instanceId: 'different' },
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(runtime.claudeIndicators).not.toHaveBeenCalled();
    expect(repository.isDisconnected('claude')).toBe(true);
  });
  it('retains disconnection on evidence failure and permits a retry', async () => {
    await repository.disconnect('claude');
    const { service, runtime } = fixture();
    const target = service.target('claude').target;
    runtime.claudeIndicators.mockRejectedValueOnce(new Error('private credential details'));
    await expect(service.reconnect('claude', { confirmed: true, target })).rejects.toThrow(
      'No reconnect was performed.'
    );
    expect(repository.isDisconnected('claude')).toBe(true);
    expect((await service.reconnect('claude', { confirmed: true, target })).connected).toBe(true);
  });
  it('serializes reconnect behind an accepted disconnect', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = repository.disconnect.bind(repository);
    vi.spyOn(repository, 'disconnect').mockImplementation(async (provider) => {
      await gate;
      await original(provider);
    });
    const { service, runtime } = fixture();
    const target = service.target('claude').target;
    const first = service.disconnect('claude', { confirmed: true, target });
    const second = service.reconnect('claude', { confirmed: true, target });
    await Promise.resolve();
    expect(runtime.claudeIndicators).not.toHaveBeenCalled();
    release();
    await first;
    await second;
    expect(repository.isDisconnected('claude')).toBe(false);
  });
  it('serializes a later disconnect behind evidence reads without blocking other providers', async () => {
    await repository.disconnect('claude');
    let release!: (value: { hasCredentialsFile: boolean }) => void;
    const { service, runtime } = fixture();
    runtime.claudeIndicators.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const target = service.target('claude').target;
    const first = service.reconnect('claude', { confirmed: true, target });
    const second = service.disconnect('claude', { confirmed: true, target });
    await service.disconnect('codex', { confirmed: true, target: service.target('codex').target });
    expect(repository.isDisconnected('claude')).toBe(true);
    expect(repository.isDisconnected('codex')).toBe(true);
    release({ hasCredentialsFile: false });
    await first;
    await second;
    expect(repository.isDisconnected('claude')).toBe(true);
  });
});
