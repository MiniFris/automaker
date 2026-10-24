import { afterEach, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { secureFs } from '@automaker/platform';
import { SetupHandlersService } from '../../../src/modules/providers/setup-handlers.service.js';
import { SetupCredentialCache } from '../../../src/modules/providers/setup-credential-cache.service.js';
import { HostSetupStatusService } from '../../../src/modules/providers/host-setup-status.service.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function fixture(initial = false) {
  const keys = new SetupCredentialCache();
  const bridge = new SetupHandlersService(keys);
  const status = new HostSetupStatusService({} as never, {} as never, keys, {
    providers: { isEnvironmentVariableConfigured: () => initial },
  } as never);
  const response = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  return { keys, bridge, status, response };
}

it('legacy store uses the injected cache observed by native status without sharing it with another app', async () => {
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  const persist = vi.spyOn(secureFs, 'writeEnvKey').mockResolvedValue(undefined);
  const first = fixture();
  const second = fixture();
  await first.bridge.run(
    'storeApiKey',
    { body: { provider: 'anthropic', apiKey: 'private-fixture-key' } } as Request,
    first.response as unknown as Response
  );
  expect(persist).toHaveBeenCalledOnce();
  expect(first.keys.get('anthropic')).toBe('private-fixture-key');
  expect(first.status.apiKeys()).toMatchObject({ hasAnthropicKey: true });
  expect(second.status.apiKeys()).toMatchObject({ hasAnthropicKey: false });
  expect(second.keys.get('anthropic')).toBeUndefined();
  expect(first.response.json).toHaveBeenCalledWith({ success: true });
});

it('legacy delete clears the owned cache and overrides the bootstrap availability hint', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'private-bootstrap-key');
  vi.spyOn(secureFs, 'removeEnvKey').mockResolvedValue(undefined);
  const state = fixture(true);
  state.keys.set('openai', 'private-stored-key');
  await state.bridge.run(
    'deleteApiKey',
    { body: { provider: 'openai' } } as Request,
    state.response as unknown as Response
  );
  expect(state.keys.get('openai')).toBeUndefined();
  expect(state.status.apiKeys()).toMatchObject({ hasOpenaiKey: false });
  expect(JSON.stringify(state.response.json.mock.calls)).not.toContain('private-');
});

it('unsupported stores do not mutate the new cache or invoke persistence', async () => {
  const persist = vi.spyOn(secureFs, 'writeEnvKey').mockResolvedValue(undefined);
  const state = fixture();
  await state.bridge.run(
    'storeApiKey',
    { body: { provider: 'unsupported', apiKey: 'private-key' } } as Request,
    state.response as unknown as Response
  );
  expect(state.response.status).toHaveBeenCalledWith(400);
  expect(state.keys.get('unsupported')).toBeUndefined();
  expect(persist).not.toHaveBeenCalled();
});
