import { ApplicationMetrics } from '../../../src/core/observability/application-metrics.js';
import { describe, expect, it, vi } from 'vitest';

import type { BaseProvider } from '../../../src/providers/base-provider.js';
import { ProviderRegistry } from '../../../src/modules/providers/provider-registry.service.js';

const provider = (name: string, supportsVision = false) =>
  ({
    getName: () => name,
    attachExecutionScope: vi.fn(),
    getCapabilities: () => ({ vision: supportsVision, tools: false, reasoning: false }),
    detectInstallation: vi.fn().mockResolvedValue({ installed: true }),
    getAvailableModels: () => [
      { id: `${name}-model`, modelString: `${name}-model`, name, supportsVision },
    ],
    getModelCapabilities: (modelId: string) => ({
      vision: modelId === `${name}-model` && supportsVision,
      tools: false,
      reasoning: false,
    }),
  }) as unknown as BaseProvider;

const connections = (disconnected = false) => ({ isDisconnected: () => disconnected });

describe('ProviderRegistry', () => {
  it('uses explicit priority and aliases without import-time registration', () => {
    const registry = new ProviderRegistry(
      [
        {
          name: 'claude',
          aliases: ['anthropic'],
          create: () => provider('claude'),
        },
        {
          name: 'codex',
          aliases: ['openai'],
          priority: 5,
          canHandleModel: (model) => model === 'shared',
          create: () => provider('codex'),
        },
        {
          name: 'cursor',
          priority: 10,
          canHandleModel: (model) => model === 'shared',
          create: () => provider('cursor'),
        },
      ],
      connections() as never,
      new ApplicationMetrics()
    );

    expect(registry.names()).toEqual(['claude', 'codex', 'cursor']);
    expect(registry.providerNameForModel('shared')).toBe('cursor');
    expect(registry.byName('anthropic')?.getName()).toBe('claude');
    expect(registry.byName('OPENAI')?.getName()).toBe('codex');
    expect(registry.providerNameForModel('unknown')).toBe('claude');
  });

  it.each([
    [
      [
        { name: 'claude', create: () => provider('claude') },
        { name: 'CLAUDE', create: () => provider('duplicate') },
      ],
      'claude',
    ],
    [
      [
        { name: 'claude', aliases: ['anthropic'], create: () => provider('claude') },
        { name: 'other', aliases: ['ANTHROPIC'], create: () => provider('other') },
      ],
      'anthropic',
    ],
  ])('rejects duplicate provider ownership', (registrations, duplicate) => {
    expect(
      () => new ProviderRegistry(registrations, connections() as never, new ApplicationMetrics())
    ).toThrow(`Duplicate provider name or alias: ${duplicate}.`);
  });

  it('fails closed for unknown capabilities and disconnected providers', () => {
    const registrations = [
      {
        name: 'claude',
        create: () => provider('claude'),
      },
    ];
    expect(
      new ProviderRegistry(registrations, connections(), new ApplicationMetrics()).supportsVision(
        'missing'
      )
    ).toBe(false);
    expect(() =>
      new ProviderRegistry(
        registrations,
        connections(true),
        new ApplicationMetrics()
      ).providerForModel('x')
    ).toThrow('disconnected');
  });

  it('rejects case-insensitive model ownership collisions during startup', () => {
    const first = provider('claude');
    const second = provider('cursor');
    second.getAvailableModels = () => [{ ...first.getAvailableModels()[0], id: 'CLAUDE-MODEL' }];
    const registry = new ProviderRegistry(
      [
        { name: 'claude', create: () => first },
        { name: 'cursor', create: () => second },
      ],
      connections() as never,
      new ApplicationMetrics()
    );
    expect(() => registry.onModuleInit()).toThrow(
      'Duplicate model ID claude-model: providers claude and cursor.'
    );
    expect(first.detectInstallation).not.toHaveBeenCalled();
    expect(second.detectInstallation).not.toHaveBeenCalled();
  });

  it('allows shared SDK model strings but rejects collisions in refreshed catalogs', () => {
    const first = provider('claude');
    const second = provider('cursor');
    const firstModel = first.getAvailableModels()[0];
    second.getAvailableModels = () => [{ ...firstModel, id: 'cursor-model' }];
    const registry = new ProviderRegistry(
      [
        { name: 'claude', create: () => first },
        { name: 'cursor', create: () => second },
      ],
      connections() as never,
      new ApplicationMetrics()
    );
    expect(() => registry.onModuleInit()).not.toThrow();
    expect(registry.allModels()).toHaveLength(2);
    second.getAvailableModels = () => [firstModel];
    expect(() => registry.allModels()).toThrow('Duplicate model ID');
  });

  it.each(['', ' model', 'model '])('rejects invalid catalog ID %j', (id) => {
    const adapter = provider('claude');
    const model = adapter.getAvailableModels()[0];
    adapter.getAvailableModels = () => [{ ...model, id }];
    const registry = new ProviderRegistry(
      [{ name: 'claude', create: () => adapter }],
      connections() as never,
      new ApplicationMetrics()
    );
    expect(() => registry.onModuleInit()).toThrow('Invalid model ID');
  });

  it('routes direct models explicitly and reports provider statuses', async () => {
    const registry = new ProviderRegistry(
      [
        { name: 'claude', create: () => provider('claude') },
        {
          name: 'openai-compatible',
          create: () => provider('openai-compatible'),
        },
      ],
      connections(),
      new ApplicationMetrics(),
      {
        statuses: vi.fn().mockResolvedValue({
          claude: { installed: true },
          'openai-compatible': { installed: true },
        }),
      } as never
    );
    expect(registry.providerNameForModel('direct-custom')).toBe('openai-compatible');
    await expect(registry.statuses()).resolves.toEqual({
      claude: { installed: true },
      'openai-compatible': { installed: true },
    });
  });
});
