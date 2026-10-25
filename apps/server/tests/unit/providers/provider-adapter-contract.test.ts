import { describe, expect, it } from 'vitest';

import { createProviderRegistrations } from '@/modules/providers/provider-registrations.js';
import { BaseProvider } from '@/providers/base-provider.js';

const registrations = createProviderRegistrations({} as never);

describe.each(registrations)('$name provider adapter contract', ({ name, create }) => {
  it('uses the managed entrypoint and rejects new execution after disposal without SDK/CLI effects', async () => {
    const provider = create();
    expect(provider.executeQuery).toBe(BaseProvider.prototype.executeQuery);
    await provider.dispose();
    await expect(
      provider.start({ prompt: 'Never execute', cwd: '/fixture', model: '__unknown__' }).next()
    ).rejects.toThrow('not accepting');
    await expect(
      provider.followUp({ prompt: 'Never execute', cwd: '/fixture', model: '__unknown__' }).next()
    ).rejects.toThrow('not accepting');
  });
  it('exposes the normalized lifecycle and a closed capability matrix', async () => {
    const provider = create();
    const capabilities = provider.getCapabilities();

    expect(provider.getName()).toBe(name);
    expect(capabilities.text).toBe(true);
    expect(capabilities.streaming).toBe(true);
    expect(Object.values(capabilities).every((value) => typeof value === 'boolean')).toBe(true);
    expect(provider.getModelCapabilities('__unknown_model__')).toEqual({
      vision: false,
      tools: false,
      reasoning: false,
    });
    expect(typeof provider.start).toBe('function');
    expect(typeof provider.followUp).toBe('function');

    const controller = new AbortController();
    provider.cancel(controller);
    expect(controller.signal.aborted).toBe(true);
    await expect(provider.dispose()).resolves.toBeUndefined();
  });
});
