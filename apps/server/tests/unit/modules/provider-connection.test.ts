import fs from 'node:fs';
import { mkdtemp, readFile, rm, mkdir, writeFile, symlink, lstat, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderConnectionRepository } from '../../../src/modules/providers/provider-connection.repository.js';
import { ProviderConnectionCommandService } from '../../../src/modules/providers/provider-connection-command.service.js';
import type { CliConnectionProvider } from '@automaker/contracts';

let directory: string;
let repository: ProviderConnectionRepository;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-provider-connection-'));
  repository = ProviderConnectionRepository.forWorkingDirectory(directory);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
const names: CliConnectionProvider[] = [
  'claude',
  'codex',
  'cursor',
  'gemini',
  'copilot',
  'opencode',
];

describe('provider connection repository', () => {
  it('provides a stable read-only target per instance and rejects stale-instance confirmation', async () => {
    const target = repository.target('claude');
    expect(target).toMatchObject({
      kind: 'host-application',
      provider: 'claude',
      workingDirectory: directory,
    });
    expect(repository.target('claude')).toEqual(target);
    const restarted = ProviderConnectionRepository.forWorkingDirectory(directory);
    expect(restarted.target('claude').instanceId).not.toBe(target.instanceId);
    await expect(
      new ProviderConnectionCommandService(restarted).disconnect('claude', {
        confirmed: true,
        target,
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await readdir(directory)).toEqual([]);
  });

  it.each(names)('persists %s disconnect without touching other providers', async (name) => {
    expect(repository.isDisconnected(name)).toBe(false);
    await repository.disconnect(name);
    expect(repository.isDisconnected(name)).toBe(true);
    const marker = path.join(directory, '.automaker', `.${name}-disconnected`);
    expect(await readFile(marker, 'utf8')).toBe('');
    if (process.platform !== 'win32') expect((await lstat(marker)).mode & 0o777).toBe(0o600);
    for (const other of names.filter((candidate) => candidate !== name))
      expect(repository.isDisconnected(other)).toBe(false);
    expect(ProviderConnectionRepository.forWorkingDirectory(directory).isDisconnected(name)).toBe(
      true
    );
  });

  it('preserves old marker contents during concurrent idempotent disconnects', async () => {
    await mkdir(path.join(directory, '.automaker'));
    const file = path.join(directory, '.automaker', '.claude-disconnected');
    await writeFile(file, '{"legacy":true}');
    await Promise.all(Array.from({ length: 4 }, () => repository.disconnect('claude')));
    expect(await readFile(file, 'utf8')).toBe('{"legacy":true}');
  });

  it('handles concurrent initial disconnects through exclusive creation', async () => {
    await Promise.all(Array.from({ length: 5 }, () => repository.disconnect('cursor')));
    expect(repository.isDisconnected('cursor')).toBe(true);
    expect(await readdir(path.join(directory, '.automaker'))).toEqual(['.cursor-disconnected']);
  });

  it.each(['constructor', '__proto__', '../outside', 'unknown'])(
    'does not resolve arbitrary provider names (%s)',
    async (name) => {
      expect(repository.isDisconnected(name)).toBe(false);
      await expect(repository.disconnect(name as never)).rejects.toMatchObject({ statusCode: 503 });
      expect(await readdir(directory)).toEqual([]);
    }
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a symlinked marker without changing its target',
    async () => {
      await mkdir(path.join(directory, '.automaker'));
      const target = path.join(directory, 'protected.txt');
      await writeFile(target, 'preserve');
      await symlink(target, path.join(directory, '.automaker', '.claude-disconnected'));
      expect(() => repository.isDisconnected('claude')).toThrow('unavailable');
      await expect(repository.disconnect('claude')).rejects.toMatchObject({ statusCode: 503 });
      expect(await readFile(target, 'utf8')).toBe('preserve');
    }
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a symlinked marker directory without writing through it',
    async () => {
      const target = path.join(directory, 'elsewhere');
      await mkdir(target);
      await symlink(target, path.join(directory, '.automaker'));
      await expect(repository.disconnect('claude')).rejects.toMatchObject({ statusCode: 503 });
      expect(() => repository.isDisconnected('claude')).toThrow('unavailable');
      expect(await readdir(target)).toEqual([]);
    }
  );

  it('fails closed on an invalid marker directory or unreadable state', async () => {
    await mkdir(path.join(directory, '.automaker', '.claude-disconnected'), { recursive: true });
    await expect(repository.disconnect('claude')).rejects.toMatchObject({ statusCode: 503 });
    expect(() => repository.isDisconnected('claude')).toThrow('unavailable');
    vi.spyOn(fs, 'lstatSync').mockImplementation(() => {
      throw Object.assign(new Error('private path'), { code: 'EACCES' });
    });
    expect(() => repository.isDisconnected('gemini')).toThrow(
      'Provider connection state is unavailable.'
    );
  });

  it('returns a safe failure when exclusive creation fails and allows a later retry', async () => {
    const open = vi
      .spyOn(fs.promises, 'open')
      .mockRejectedValueOnce(new Error('private filesystem details'));
    await expect(repository.disconnect('gemini')).rejects.toThrow(
      'Provider connection state could not be saved.'
    );
    open.mockRestore();
    expect(repository.isDisconnected('gemini')).toBe(false);
    await repository.disconnect('gemini');
    expect(repository.isDisconnected('gemini')).toBe(true);
  });
});

describe('provider connection command', () => {
  it.each(['instanceId', 'provider', 'kind', 'workingDirectory'])(
    'refuses a mismatched confirmed target (%s) before persistence',
    async (field) => {
      const service = new ProviderConnectionCommandService(repository);
      const target = service.target('claude').target;
      const write = vi.spyOn(repository, 'disconnect');
      await expect(
        service.disconnect('claude', {
          confirmed: true,
          target: { ...target, [field]: 'different' },
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(write).not.toHaveBeenCalled();
      expect(await readdir(directory)).toEqual([]);
    }
  );

  it('requires confirmation and returns the actual persisted target on success', async () => {
    const service = new ProviderConnectionCommandService(repository);
    const target = service.target('claude').target;
    await expect(
      service.disconnect('claude', { confirmed: false, target } as never)
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.isDisconnected('claude')).toBe(false);
    expect(await service.disconnect('claude', { confirmed: true, target })).toEqual({
      success: true,
      connected: false,
      target,
      message: 'Claude CLI is now disconnected from the app',
    });
  });

  it('drains an accepted write on shutdown and refuses new admission', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(repository, 'disconnect').mockReturnValue(pending);
    const service = new ProviderConnectionCommandService(repository);
    const target = service.target('claude').target;
    const write = service.disconnect('claude', { confirmed: true, target });
    let closed = false;
    const closing = service.onApplicationShutdown();
    expect(service.onApplicationShutdown()).toBe(closing);
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(() => service.target('claude')).toThrow('shutting down');
    await expect(service.disconnect('claude', { confirmed: true, target })).rejects.toMatchObject({
      statusCode: 503,
    });
    finish();
    await write;
    await closing;
    expect(closed).toBe(true);
  });
});
