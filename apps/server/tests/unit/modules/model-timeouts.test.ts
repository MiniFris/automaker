import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DEFAULT_MODEL_TIMEOUTS } from '@automaker/types';
import { SettingsService } from '@/services/settings-service.js';
import { nativeSettings } from '../../helpers/native-settings.js';

let directory: string,
  settings: SettingsService,
  fixture: Awaited<ReturnType<typeof nativeSettings>>,
  url: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'model-timeout-api-'));
  fixture = await nativeSettings(directory);
  settings = fixture.settings;
  await settings.updateCredentials({
    openaiCompatibleApiKeys: { fixture: 'DO_NOT_RETURN_THIS_KEY' },
  });
  url = fixture.origin + '/api/settings/model-timeouts';
});
afterEach(async () => {
  await fixture?.close();
  await fs.rm(directory, { recursive: true, force: true });
});
const save = (timeouts: unknown, extra = {}) =>
  fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeouts, ...extra }),
  });
const saveProvider = (provider: string, timeouts: unknown) =>
  fetch(url + '/' + provider, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeouts }),
  });
it('returns only applicable legacy values and saves independent provider settings', async () => {
  await settings.updateGlobalSettings({
    modelTimeouts: { requestTimeoutMs: 111, cliIdleTimeoutMs: 222, agentTimeoutMs: 333 },
  });
  expect(await (await fetch(url + '/cursor')).json()).toEqual({
    success: true,
    timeouts: { cliIdleTimeoutMs: 222 },
  });
  expect(await (await saveProvider('cursor', { cliIdleTimeoutMs: 444 })).json()).toEqual({
    success: true,
    timeouts: { cliIdleTimeoutMs: 444 },
  });
  expect(await (await fetch(url + '/claude')).json()).toEqual({
    success: true,
    timeouts: { requestTimeoutMs: 111, cliIdleTimeoutMs: 222 },
  });
  await saveProvider('cursor', {});
  expect(await (await fetch(url + '/cursor')).json()).toEqual({ success: true, timeouts: {} });
  expect((await settings.getCredentials()).openaiCompatibleApiKeys?.fixture).toBe(
    'DO_NOT_RETURN_THIS_KEY'
  );
  expect(
    (await new SettingsService(path.join(directory, 'data')).getGlobalSettings())
      .providerModelTimeouts?.cursor
  ).toEqual({});
});
it('preserves both providers during concurrent saves', async () => {
  const responses = await Promise.all([
    saveProvider('claude', { requestTimeoutMs: 3000 }),
    saveProvider('codex', { cliIdleTimeoutMs: 4000 }),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect((await settings.getGlobalSettings()).providerModelTimeouts).toEqual({
    claude: { requestTimeoutMs: 3000 },
    codex: { cliIdleTimeoutMs: 4000 },
  });
});
it.each([
  ['unknown', {}],
  ['claude', { agentTimeoutMs: 10 }],
  ['cursor', { requestTimeoutMs: 10 }],
  ['codex', { cliIdleTimeoutMs: 0 }],
])('rejects invalid scoped updates (%s)', async (provider, timeouts) => {
  expect((await saveProvider(provider as string, timeouts)).status).toBe(400);
  expect((await settings.getGlobalSettings()).providerModelTimeouts).toBeUndefined();
});
it('returns only a secret-free timeout DTO, not global connection settings', async () => {
  expect(await (await fetch(url)).json()).toEqual({ success: true, timeouts: {} });
});
it('persists all timing fields across service restart without modifying credentials', async () => {
  const timeouts = {
    ...DEFAULT_MODEL_TIMEOUTS,
    requestTimeoutMs: 900_000,
    responseHeadersTimeoutMs: 120_000,
    agentTimeoutMs: 7_200_000,
    toolTimeoutMs: 900_000,
    remoteProcessTimeoutMs: 3_600_000,
    cliIdleTimeoutMs: 300_000,
  };
  expect(await (await save(timeouts)).json()).toEqual({ success: true, timeouts });
  const fresh = new SettingsService(path.join(directory, 'data'));
  expect((await fresh.getGlobalSettings()).modelTimeouts).toEqual(timeouts);
  expect((await fresh.getCredentials()).openaiCompatibleApiKeys?.fixture).toBe(
    'DO_NOT_RETURN_THIS_KEY'
  );
  expect(await (await save({})).json()).toEqual({ success: true, timeouts: {} });
});
it.each([
  { requestTimeoutMs: 0 },
  { requestTimeoutMs: 1.5 },
  { requestTimeoutMs: 2_147_483_648 },
  { unknown: 10 },
  null,
])('rejects invalid values before persistence', async (timeouts) => {
  expect((await save(timeouts)).status).toBe(400);
  expect((await settings.getGlobalSettings()).modelTimeouts).toBeUndefined();
});
it('rejects unrelated fields rather than using this endpoint as a generic settings writer', async () => {
  expect((await save({}, { credentials: { apiKey: 'SHOULD_NOT_BE_ECHOED' } })).status).toBe(400);
  expect((await settings.getGlobalSettings()).modelTimeouts).toBeUndefined();
});
it('also validates writes through the existing global settings service', async () => {
  await expect(
    settings.updateGlobalSettings({ modelTimeouts: { agentTimeoutMs: -1 } })
  ).rejects.toThrow('Invalid model timeout');
});
