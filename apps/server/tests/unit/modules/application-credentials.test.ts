import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsService } from '../../../src/services/settings-service.js';
import { ApplicationCredentialsService } from '../../../src/modules/providers/application-credentials.service.js';
import { SetupCredentialCache } from '../../../src/modules/providers/setup-credential-cache.service.js';

const owned: string[] = [];
afterEach(async () => {
  for (const directory of owned.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function fixture(bootstrap: NodeJS.ProcessEnv = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-application-keys-'));
  owned.push(directory);
  const settings = new SettingsService(directory);
  const cache = new SetupCredentialCache();
  const create = () =>
    new ApplicationCredentialsService(
      new SettingsService(directory),
      Object.freeze({ ...bootstrap }),
      new SetupCredentialCache()
    );
  const service = new ApplicationCredentialsService(
    settings,
    Object.freeze({ ...bootstrap }),
    cache
  );
  return { directory, settings, cache, create, service };
}
it('resolves bootstrap keys without modifying ambient environment or persisting a read', async () => {
  const before = { ...process.env };
  const { service, directory } = await fixture({
    OPENAI_API_KEY: 'sk-bootstrap',
    CODEX_API_KEY: 'wrong',
  });
  expect(await service.environment()).toMatchObject({
    OPENAI_API_KEY: 'sk-bootstrap',
    CODEX_API_KEY: 'sk-bootstrap',
  });
  await expect(stat(path.join(directory, 'credentials.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(process.env).toEqual(before);
});
it.each(['anthropic', 'openai', 'google'] as const)(
  'persists %s and disables bootstrap fallback after deletion and restart',
  async (provider) => {
    const name = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GEMINI_API_KEY',
    }[provider];
    const { settings, service, create, directory } = await fixture({ [name]: 'sk-bootstrap' });
    await settings.setSetupCredential(provider, 'sk-managed');
    expect((await service.environment())[name]).toBe('sk-managed');
    expect((await create().environment())[name]).toBe('sk-managed');
    await settings.setSetupCredential(provider, null);
    expect((await service.environment())[name]).toBeUndefined();
    expect((await create().environment())[name]).toBeUndefined();
    if (provider === 'openai') expect((await create().environment()).CODEX_API_KEY).toBeUndefined();
    const record = JSON.parse(await readFile(path.join(directory, 'credentials.json'), 'utf8'));
    expect(record.disabledBootstrapApiKeys[provider]).toBe(true);
    expect(record.apiKeys[provider]).toBe('');
    if (process.platform !== 'win32')
      expect((await stat(path.join(directory, 'credentials.json'))).mode & 0o777).toBe(0o600);
    await settings.setSetupCredential(provider, 'sk-replacement');
    expect((await create().environment())[name]).toBe('sk-replacement');
  }
);

it('selects managed Gemini keys without an alternate Google override and preserves deletion after restart', async () => {
  const { service, create } = await fixture({
    GEMINI_API_KEY: 'bootstrap-gemini',
    GOOGLE_API_KEY: 'bootstrap-vertex',
  });
  expect(await service.environment()).toMatchObject({
    GEMINI_API_KEY: 'bootstrap-gemini',
    GOOGLE_API_KEY: 'bootstrap-vertex',
  });
  await service.change('google', 'managed-gemini');
  expect((await service.environment()).GEMINI_API_KEY).toBe('managed-gemini');
  expect((await service.environment()).GOOGLE_API_KEY).toBeUndefined();
  await service.change('google', null);
  const restarted = create();
  expect((await restarted.environment()).GEMINI_API_KEY).toBeUndefined();
  expect((await restarted.environment()).GOOGLE_API_KEY).toBeUndefined();
  expect((await restarted.presence()).hasGoogleKey).toBe(false);
});
it('switches API-key and subscription token modes without leaving a competing bootstrap override active', async () => {
  const { settings, create } = await fixture({
    ANTHROPIC_API_KEY: 'sk-bootstrap',
    ANTHROPIC_AUTH_TOKEN: 'other',
    CLAUDE_CODE_OAUTH_TOKEN: 'old-token',
  });
  await settings.setSetupCredential('anthropic_oauth_token', 'subscription-token');
  const oauth = await create().environment();
  expect(oauth.CLAUDE_CODE_OAUTH_TOKEN).toBe('subscription-token');
  expect(oauth.ANTHROPIC_API_KEY).toBeUndefined();
  expect(oauth.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  await settings.setSetupCredential('anthropic', 'sk-managed');
  const api = await create().environment();
  expect(api.ANTHROPIC_API_KEY).toBe('sk-managed');
  expect(api.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  expect(api.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
});
it('serializes setup and ordinary credential writes on the same queue without losing other providers', async () => {
  const { settings } = await fixture();
  await Promise.all([
    settings.setSetupCredential('anthropic', 'sk-anthropic'),
    settings.updateCredentials({ apiKeys: { google: 'google-key' } } as never),
    settings.setSetupCredential('openai', 'sk-openai'),
  ]);
  expect((await settings.getCredentials()).apiKeys).toMatchObject({
    anthropic: 'sk-anthropic',
    google: 'google-key',
    openai: 'sk-openai',
  });
});
it('does not share keys or deletion policy across applications', async () => {
  const first = await fixture({ OPENAI_API_KEY: 'sk-first' });
  const second = await fixture({ OPENAI_API_KEY: 'sk-second' });
  await first.settings.setSetupCredential('openai', null);
  expect((await first.service.environment()).OPENAI_API_KEY).toBeUndefined();
  expect((await second.service.environment()).OPENAI_API_KEY).toBe('sk-second');
});
it('retains the transitional app-scoped cache until legacy key commands are removed', async () => {
  const { cache, service } = await fixture({ OPENAI_API_KEY: 'sk-bootstrap' });
  cache.set('openai', 'sk-legacy-cache');
  expect((await service.environment()).OPENAI_API_KEY).toBe('sk-legacy-cache');
  cache.set('openai', '');
  cache.setEnvironmentConfigured('OPENAI_API_KEY', false);
  expect((await service.environment()).OPENAI_API_KEY).toBeUndefined();
});
it('switches transitional cached Anthropic modes without retaining a conflicting managed key', async () => {
  const { settings, cache, service } = await fixture({ ANTHROPIC_API_KEY: 'sk-bootstrap' });
  await settings.setSetupCredential('anthropic', 'sk-managed');
  cache.set('anthropic_oauth_token', 'cached-subscription');
  expect((await service.environment()).ANTHROPIC_API_KEY).toBeUndefined();
  expect((await service.environment()).CLAUDE_CODE_OAUTH_TOKEN).toBe('cached-subscription');
  cache.set('anthropic', 'sk-cached-api');
  expect((await service.environment()).ANTHROPIC_API_KEY).toBe('sk-cached-api');
  expect((await service.environment()).CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
});
it('activates only committed writes and clears stale wizard values on deletion', async () => {
  const { cache, settings, service, create } = await fixture({ OPENAI_API_KEY: 'sk-bootstrap' });
  cache.set('openai', 'sk-stale-wizard');
  await service.change('openai', 'sk-managed');
  expect(cache.get('openai')).toBeUndefined();
  expect((await service.environment()).OPENAI_API_KEY).toBe('sk-managed');
  cache.set('openai', 'sk-stale-wizard');
  await service.change('openai', null);
  expect((await service.environment()).OPENAI_API_KEY).toBeUndefined();
  expect((await create().environment()).OPENAI_API_KEY).toBeUndefined();
  vi.spyOn(settings, 'setSetupCredential').mockRejectedValue(new Error('offline write failure'));
  cache.set('openai', 'sk-previous-active');
  await expect(service.change('openai', 'sk-uncommitted')).rejects.toThrow('offline write failure');
  expect(cache.get('openai')).toBe('sk-previous-active');
});
it('drains accepted credential writes on shutdown and rejects new admission', async () => {
  const { settings, service } = await fixture();
  let finish!: () => void;
  vi.spyOn(settings, 'setSetupCredential').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const pending = service.change('openai', 'sk-pending');
  await vi.waitFor(() => expect(settings.setSetupCredential).toHaveBeenCalledOnce());
  const closing = service.beforeApplicationShutdown();
  expect(service.beforeApplicationShutdown()).toBe(closing);
  await expect(service.change('openai', 'sk-new')).rejects.toThrow('shutting down');
  finish();
  await pending;
  await closing;
});
it('fails closed for corrupt credentials instead of silently resurrecting a deleted bootstrap key', async () => {
  const { settings, directory, create } = await fixture({ OPENAI_API_KEY: 'sk-bootstrap' });
  await settings.setSetupCredential('openai', null);
  await writeFile(path.join(directory, 'credentials.json'), '{corrupt-private-record');
  await expect(create().environment()).rejects.toThrow('Private settings are unavailable.');
  await expect(settings.setSetupCredential('openai', 'sk-next')).rejects.toThrow(
    'Private settings are unavailable.'
  );
  expect(await readFile(path.join(directory, 'credentials.json'), 'utf8')).toBe(
    '{corrupt-private-record'
  );
});
it('fails closed on malformed deletion policy instead of ignoring it', async () => {
  const { directory, create } = await fixture({ OPENAI_API_KEY: 'sk-bootstrap' });
  await writeFile(
    path.join(directory, 'credentials.json'),
    JSON.stringify({ apiKeys: {}, disabledBootstrapApiKeys: ['openai'] })
  );
  await expect(create().environment()).rejects.toThrow('Application credential policy is invalid.');
});
it('rejects malformed policy updates without overwriting a valid credential record', async () => {
  const { settings, create } = await fixture({ OPENAI_API_KEY: 'sk-bootstrap' });
  await settings.setSetupCredential('openai', null);
  await expect(
    settings.updateCredentials({ disabledBootstrapApiKeys: ['openai'] } as never)
  ).rejects.toThrow('Application credential policy is invalid.');
  expect((await create().environment()).OPENAI_API_KEY).toBeUndefined();
  await settings.setSetupCredential('openai', 'sk-after-rejection');
  expect((await create().environment()).OPENAI_API_KEY).toBe('sk-after-rejection');
});
it.each(['__proto__', 'unknown'])('rejects unsupported storage keys (%s)', async (provider) => {
  const { settings } = await fixture();
  await expect(settings.setSetupCredential(provider as never, 'private')).rejects.toThrow(
    'Invalid application credential update.'
  );
});
