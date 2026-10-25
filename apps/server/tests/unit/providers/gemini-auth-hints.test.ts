import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs/promises';
import { GeminiProvider } from '@/providers/gemini-provider.js';

vi.mock('child_process', async (original) => ({
  ...(await original<object>()),
  execSync: vi.fn(),
}));
vi.mock('fs/promises', async (original) => ({
  ...(await original<object>()),
  stat: vi.fn(),
  readFile: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.stat).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
});
afterEach(() => vi.unstubAllEnvs());

it('does not inherit ambient credentials or launch commands for passive status', async () => {
  vi.stubEnv('GEMINI_API_KEY', 'host-secret-fixture');
  const result = await new GeminiProvider({}, async () => ({})).checkAuth();
  expect(result).toMatchObject({
    authenticated: false,
    authenticationChecked: false,
    hasApiKey: false,
    hasVertexConfig: false,
    hasConfigFile: false,
    method: 'none',
  });
  expect(execSync).not.toHaveBeenCalled();
  expect(fs.readFile).not.toHaveBeenCalled();
});
it.each([
  [{ GEMINI_API_KEY: 'private-gemini-fixture' }, 'api_key', true, false],
  [{ GOOGLE_API_KEY: 'private-vertex-fixture' }, 'vertex_ai', true, true],
  [{ GOOGLE_CLOUD_PROJECT: 'project-only' }, 'vertex_ai', false, true],
] as const)(
  'reports only unverified environment hints (%#)',
  async (environment, method, hasApiKey, hasVertexConfig) => {
    const result = await new GeminiProvider({}, async () => environment).checkAuth();
    expect(result).toMatchObject({
      authenticated: false,
      authenticationChecked: false,
      method,
      hasApiKey,
      hasVertexConfig,
    });
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(execSync).not.toHaveBeenCalled();
  }
);
it('stats the application home configuration without reading selected auth type or token', async () => {
  vi.mocked(fs.stat).mockResolvedValue({ isFile: () => true } as never);
  const result = await new GeminiProvider({}, async () => ({ HOME: '/fixture/home' })).checkAuth();
  expect(fs.stat).toHaveBeenCalledWith('/fixture/home/.gemini/settings.json');
  expect(result).toMatchObject({ hasConfigFile: true, authenticated: false, method: 'none' });
  expect(fs.readFile).not.toHaveBeenCalled();
});
it('does not promote a directory or a filesystem failure into a credential hint', async () => {
  vi.mocked(fs.stat).mockResolvedValueOnce({ isFile: () => false } as never);
  const provider = new GeminiProvider({}, async () => ({}));
  expect((await provider.checkAuth()).hasConfigFile).toBe(false);
  vi.mocked(fs.stat).mockRejectedValueOnce(new Error('private-key /private/path'));
  const result = await provider.checkAuth();
  expect(result).toMatchObject({
    hasConfigFile: false,
    error: 'Local configuration could not be inspected.',
  });
  expect(JSON.stringify(result)).not.toContain('private-key');
});
it('fails closed when the application environment cannot be read', async () => {
  const provider = new GeminiProvider({}, async () => {
    throw new Error('Unavailable');
  });
  await expect(provider.checkAuth()).rejects.toThrow('Unavailable');
  expect(execSync).not.toHaveBeenCalled();
});
