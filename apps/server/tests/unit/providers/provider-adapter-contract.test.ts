import { describe, expect, it } from 'vitest';

import { createProviderRegistrations } from '@/modules/providers/provider-registrations.js';

const registrations = createProviderRegistrations({} as never);

describe.each(registrations)('$name provider adapter contract', ({ name, create }) => {
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
