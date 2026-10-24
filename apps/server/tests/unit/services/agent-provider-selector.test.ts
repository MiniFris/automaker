import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeCompatibleProvider, ExecutionEnvironmentBinding } from '@automaker/types';
import * as settingsHelpers from '../../../src/lib/settings-helpers.js';
import type { SettingsService } from '../../../src/services/settings-service.js';
import type { ProviderRegistry } from '../../../src/modules/providers/provider-registry.service.js';
import { ToolPolicyService } from '../../../src/modules/providers/tool-policy.service.js';
import { AgentProviderSelector } from '../../../src/services/agent/agent-provider-selector.js';

vi.mock('../../../src/lib/settings-helpers.js', () => ({
  getProviderByModelId: vi.fn(),
  resolveProviderContext: vi.fn(),
}));
const provider = { id: 'custom', name: 'Custom' } as ClaudeCompatibleProvider;
const settings = {} as SettingsService;
const registry = {
  providerForModel: vi.fn(),
  supportsVision: vi.fn(),
  providerNameForModel: vi.fn(),
  byName: vi.fn(),
};
const selector = new AgentProviderSelector(registry as unknown as ProviderRegistry);
const result = (value: ClaudeCompatibleProvider | undefined, resolvedModel?: string) => ({
  provider: value,
  resolvedModel,
  modelConfig: undefined,
  credentials: undefined,
});
const input = () => ({ requestedModel: 'GLM-4.7', settings, signal: new AbortController().signal });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(settingsHelpers.getProviderByModelId).mockResolvedValue(
    result(provider, 'claude-sonnet-4-6')
  );
  vi.mocked(settingsHelpers.resolveProviderContext).mockResolvedValue(
    result(provider, 'claude-opus-4-6')
  );
});

describe('AgentProviderSelector', () => {
  it('resolves explicit endpoint identity before model-only lookup', async () => {
    expect(await selector.resolve({ ...input(), providerId: 'custom' })).toEqual({
      provider,
      resolvedModel: 'claude-opus-4-6',
    });
    expect(settingsHelpers.resolveProviderContext).toHaveBeenCalledWith(
      settings,
      'GLM-4.7',
      'custom',
      '[AgentService]'
    );
    expect(settingsHelpers.getProviderByModelId).not.toHaveBeenCalled();
  });
  it('uses the existing model lookup when no explicit endpoint was selected', async () => {
    expect(await selector.resolve(input())).toEqual({
      provider,
      resolvedModel: 'claude-sonnet-4-6',
    });
    expect(settingsHelpers.getProviderByModelId).toHaveBeenCalledWith(
      'GLM-4.7',
      settings,
      '[AgentService]'
    );
    expect(settingsHelpers.resolveProviderContext).not.toHaveBeenCalled();
  });
  it('does not cache endpoint configuration between requests', async () => {
    vi.mocked(settingsHelpers.getProviderByModelId)
      .mockResolvedValueOnce(result(provider))
      .mockResolvedValueOnce(result(undefined));
    expect(await selector.resolve(input())).toEqual({ provider, resolvedModel: undefined });
    expect(await selector.resolve(input())).toEqual({});
  });
  it('performs no settings lookup without settings or a model', async () => {
    expect(await selector.resolve({ ...input(), settings: null })).toEqual({});
    expect(await selector.resolve({ ...input(), requestedModel: undefined })).toEqual({});
    expect(settingsHelpers.getProviderByModelId).not.toHaveBeenCalled();
  });
  it('never changes endpoint selection after a lookup failure', async () => {
    const failure = new Error('Unavailable provider settings');
    vi.mocked(settingsHelpers.resolveProviderContext).mockRejectedValue(failure);
    await expect(selector.resolve({ ...input(), providerId: 'custom' })).rejects.toBe(failure);
    expect(settingsHelpers.getProviderByModelId).not.toHaveBeenCalled();
    expect(registry.providerForModel).not.toHaveBeenCalled();
  });
  it('checks cancellation before and after asynchronous selection', async () => {
    const controller = new AbortController();
    vi.mocked(settingsHelpers.getProviderByModelId).mockImplementationOnce(async () => {
      controller.abort();
      return result(provider);
    });
    await expect(selector.resolve({ ...input(), signal: controller.signal })).rejects.toMatchObject(
      { name: 'AbortError' }
    );
    vi.mocked(settingsHelpers.getProviderByModelId).mockClear();
    await expect(selector.resolve({ ...input(), signal: controller.signal })).rejects.toMatchObject(
      { name: 'AbortError' }
    );
    expect(settingsHelpers.getProviderByModelId).not.toHaveBeenCalled();
  });
  it('uses the original custom API ID, not its mapped SDK model, for routing and execution', () => {
    expect(
      selector.models({ provider, resolvedModel: 'claude-opus-4-6' }, 'GLM-4.7', 'claude-opus-4-6')
    ).toEqual({ routingModel: 'GLM-4.7', bareModel: 'GLM-4.7' });
  });
  it.each([
    ['codex-gpt-5.1-codex-max', 'gpt-5.1-codex-max'],
    ['cursor-auto', 'auto'],
    ['direct-Exact/Model', 'Exact/Model'],
  ])(
    'retains the routing identity while stripping only the adapter prefix: %s',
    (model, bareModel) => {
      expect(selector.models({}, model, model)).toEqual({ routingModel: model, bareModel });
    }
  );
  it.each(['ssh', 'docker', 'local', 'legacy', undefined] as const)(
    'uses controller disconnection policy appropriate for binding=%s',
    (type) => {
      const binding = type ? ({ type } as ExecutionEnvironmentBinding) : undefined;
      const adapter = {};
      registry.providerForModel.mockReturnValue(adapter);
      expect(selector.forQuery('cursor-auto', binding)).toBe(adapter);
      expect(registry.providerForModel).toHaveBeenCalledWith('cursor-auto', {
        throwOnDisconnected: type !== 'ssh' && type !== 'docker',
      });
    }
  );
  it('queries vision capability without instantiating an execution', () => {
    registry.supportsVision.mockReturnValue(false);
    expect(selector.supportsVision('direct-Exact/Model')).toBe(false);
    expect(registry.supportsVision).toHaveBeenCalledWith('direct-Exact/Model');
    expect(registry.providerForModel).not.toHaveBeenCalled();
  });
  it('applies tool policy using explicit adapter capabilities and fails closed when unknown', () => {
    const policySelector = new AgentProviderSelector(
      registry as unknown as ProviderRegistry,
      new ToolPolicyService()
    );
    registry.providerNameForModel.mockReturnValue('fixture');
    registry.byName.mockReturnValue({ getCapabilities: () => ({ tools: true }) });
    const requested = ['read', 'Bash'];
    expect(policySelector.allowedTools('fixture-model', requested)).toEqual(['Read', 'Bash']);
    expect(requested).toEqual(['read', 'Bash']);
    registry.byName.mockReturnValue(undefined);
    expect(policySelector.allowedTools('fixture-model', requested)).toEqual([]);
    expect(registry.byName).toHaveBeenCalledWith('fixture');
  });
});
