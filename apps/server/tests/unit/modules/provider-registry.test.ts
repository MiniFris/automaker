import { describe, expect, it, vi } from 'vitest';

import type { BaseProvider } from '../../../src/providers/base-provider.js';
import { ProviderRegistry } from '../../../src/modules/providers/provider-registry.service.js';

const provider = (name: string, supportsVision = false) =>
  ({
    getName: () => name,
    detectInstallation: vi.fn().mockResolvedValue({ installed: true }),
    getAvailableModels: () => [
      { id: `${name}-model`, modelString: `${name}-model`, name, supportsVision },
    ],
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
      connections() as never
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
    expect(() => new ProviderRegistry(registrations, connections() as never)).toThrow(
      `Duplicate provider name or alias: ${duplicate}.`
    );
  });

  it('fails closed for unknown capabilities and disconnected providers', () => {
    const registrations = [
      {
        name: 'claude',
        create: () => provider('claude'),
      },
    ];
    expect(new ProviderRegistry(registrations, connections()).supportsVision('missing')).toBe(
      false
    );
    expect(() =>
      new ProviderRegistry(registrations, connections(true)).providerForModel('x')
    ).toThrow('disconnected');
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
      connections()
    );
    expect(registry.providerNameForModel('direct-custom')).toBe('openai-compatible');
    await expect(registry.statuses()).resolves.toEqual({
      claude: { installed: true },
      'openai-compatible': { installed: true },
    });
  });
});
