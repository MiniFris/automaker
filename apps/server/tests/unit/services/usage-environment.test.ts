import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import { execFileSync, spawn } from 'child_process';
import * as pty from 'node-pty';
import path from 'node:path';
import { ClaudeUsageService } from '../../../src/services/claude-usage-service.js';
import { GeminiUsageService } from '../../../src/services/gemini-usage-service.js';
import { ZaiUsageService } from '../../../src/services/zai-usage-service.js';

vi.mock('fs', async (original) => ({
  ...(await original<typeof import('fs')>()),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  realpathSync: vi.fn(),
}));
vi.mock('child_process', async (original) => ({
  ...(await original<typeof import('child_process')>()),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('application-owned usage environment seams', () => {
  it('uses the captured Gemini HOME, discovery environment and cwd, including secondary search', async () => {
    const environment = { HOME: '/offline-home', PATH: '/offline-bin', FIXTURE: 'before' };
    const service = new GeminiUsageService(environment, '/offline-workspace');
    environment.HOME = '/changed';
    environment.FIXTURE = 'after';
    vi.mocked(fs.existsSync).mockImplementation(
      (file) =>
        String(file) === path.join('/offline-home', '.gemini', 'oauth_creds.json') ||
        String(file) === '/offline-bin/gemini'
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ refresh_token: 'offline-refresh-only' })
    );
    vi.mocked(fs.realpathSync).mockReturnValue('/offline-bin/gemini');
    vi.mocked(execFileSync).mockImplementation((file) => {
      if (file === 'find') return '';
      return '/offline-bin/gemini\n';
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await service.fetchUsageData()).toMatchObject({ authenticated: false });
    const calls = vi.mocked(execFileSync).mock.calls;
    expect(calls).toHaveLength(process.platform === 'win32' ? 1 : 2);
    for (const [, , options] of calls) {
      expect(options).toMatchObject({
        env: { HOME: '/offline-home', PATH: '/offline-bin', FIXTURE: 'before' },
        cwd: '/offline-workspace',
        timeout: 5000,
      });
      expect((options as { env: NodeJS.ProcessEnv }).env).not.toHaveProperty('ANTHROPIC_API_KEY');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses USERPROFILE for Gemini when HOME is absent and does not use the ambient HOME', async () => {
    const service = new GeminiUsageService({ USERPROFILE: '/offline-profile' });
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(await service.isAvailable()).toBe(false);
    expect(vi.mocked(fs.existsSync).mock.calls.map(([file]) => String(file))).toEqual([
      path.join('/offline-profile', '.gemini', 'oauth_creds.json'),
      path.join('/offline-profile', '.config', 'gemini', 'oauth_creds.json'),
    ]);
  });

  it('does not use ambient z.ai credentials or URLs when the application omits them', () => {
    vi.stubEnv('Z_AI_API_KEY', 'ambient-offline-key');
    vi.stubEnv('Z_AI_API_HOST', 'https://ambient.invalid');
    const service = new ZaiUsageService({});
    expect(service.getApiToken()).toBeNull();
    expect(service.isAvailable()).toBe(false);
    expect(service.getApiHost()).toBe('https://api.z.ai');
  });

  it('captures z.ai configuration and does not borrow a mutable environment object', async () => {
    const environment = {
      Z_AI_API_KEY: 'fixture-key',
      Z_AI_API_HOST: 'fixture.invalid',
      Z_AI_QUOTA_URL: 'https://fixture.invalid/quota',
    };
    const service = new ZaiUsageService(environment);
    environment.Z_AI_API_KEY = 'changed-key';
    environment.Z_AI_API_HOST = 'changed.invalid';
    environment.Z_AI_QUOTA_URL = 'https://changed.invalid/quota';
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await service.fetchUsageData();
    await service.verifyApiKey('explicit-key');
    expect(service.getApiToken()).toBe('fixture-key');
    expect(service.getApiHost()).toBe('https://fixture.invalid');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://fixture.invalid/quota',
      'https://fixture.invalid/quota',
    ]);
  });

  it('fails Claude discovery and usage closed when application credentials cannot be read', async () => {
    const service = new ClaudeUsageService(async () => {
      throw new Error('credentials unavailable');
    });
    await expect(service.isAvailable()).rejects.toThrow('credentials unavailable');
    await expect(service.fetchUsageData()).rejects.toThrow('credentials unavailable');
    expect(spawn).not.toHaveBeenCalled();
    expect(pty.spawn).not.toHaveBeenCalled();
  });

  it('re-reads Claude credentials for discovery without letting later mutations change spawn options', async () => {
    const environment = { HOME: '/fixture-home', ANTHROPIC_API_KEY: 'first-key' };
    const reader = vi.fn(async () => environment);
    const service = new ClaudeUsageService(reader, '/fixture-workspace');
    const child = {
      on: vi.fn((event, callback) => {
        if (event === 'close') callback(0);
        return child;
      }),
    };
    vi.mocked(spawn).mockReturnValue(child as never);
    expect(await service.isAvailable()).toBe(true);
    environment.ANTHROPIC_API_KEY = 'second-key';
    expect(await service.isAvailable()).toBe(true);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(vi.mocked(spawn).mock.calls.map(([, , options]) => options)).toEqual([
      { env: { HOME: '/fixture-home', ANTHROPIC_API_KEY: 'first-key' }, cwd: '/fixture-workspace' },
      {
        env: { HOME: '/fixture-home', ANTHROPIC_API_KEY: 'second-key' },
        cwd: '/fixture-workspace',
      },
    ]);
  });
});
