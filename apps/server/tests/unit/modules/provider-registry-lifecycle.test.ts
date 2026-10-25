import { expect, it, vi } from 'vitest';
import { ProviderRegistry } from '../../../src/modules/providers/provider-registry.service.js';
import type { ProviderExecutionScope } from '../../../src/providers/provider-execution-scope.js';

function fixture() {
  const registry = new ProviderRegistry(
    [],
    {} as never,
    { providerQueryStarted: vi.fn() } as never
  );
  const scope = (registry as unknown as { executions: ProviderExecutionScope }).executions;
  return { registry, scope };
}
it('closes provider admission synchronously and drains once across explicit and Nest entry points', async () => {
  const { registry, scope } = fixture();
  const dispose = vi.spyOn(scope, 'dispose');
  const first = registry.close();
  expect(() =>
    scope.admit({
      controller: new AbortController(),
      done: Promise.resolve(),
      close: async () => {},
      unconfirmed: false,
      failed: false,
      cancelled: false,
    })
  ).toThrow('not accepting');
  expect(registry.close()).toBe(first);
  expect(registry.onApplicationShutdown()).toBe(first);
  await first;
  expect(registry.onApplicationShutdown()).toBe(first);
  expect(dispose).toHaveBeenCalledOnce();
});
it('retains the same rejected drain and error across explicit close and later Nest hooks', async () => {
  const { registry, scope } = fixture();
  const failure = new Error('fixture provider outcome unconfirmed');
  const dispose = vi.spyOn(scope, 'dispose').mockRejectedValue(failure);
  const first = registry.close();
  expect(registry.onApplicationShutdown()).toBe(first);
  await expect(first).rejects.toBe(failure);
  expect(registry.close()).toBe(first);
  await expect(registry.onApplicationShutdown()).rejects.toBe(failure);
  expect(dispose).toHaveBeenCalledOnce();
});
it('installs drain identity before synchronous cancellation can re-enter close', async () => {
  const { registry, scope } = fixture();
  const original = scope.dispose.bind(scope);
  let reentered: Promise<void> | undefined;
  const dispose = vi.spyOn(scope, 'dispose').mockImplementation(() => {
    reentered = registry.close();
    return original();
  });
  const first = registry.close();
  expect(reentered).toBe(first);
  expect(registry.onApplicationShutdown()).toBe(first);
  await first;
  expect(dispose).toHaveBeenCalledOnce();
});
