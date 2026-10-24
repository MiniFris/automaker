import { ApplicationMetrics } from '../../../src/core/observability/application-metrics.js';
import { describe, expect, it, vi } from 'vitest';
import { MockProvider } from '../../helpers/mock-provider.js';
import {
  ProviderExecutionScope,
  ProviderCleanupError,
  managedProviderStream,
} from '../../../src/providers/provider-execution-scope.js';
import { ProviderRegistry } from '../../../src/modules/providers/provider-registry.service.js';
import type { ExecuteOptions, ProviderMessage } from '../../../src/providers/types.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
class ControlledProvider extends MockProvider {
  constructor(readonly body: (options: ExecuteOptions) => AsyncGenerator<ProviderMessage>) {
    super('claude');
  }
  protected execute(options: ExecuteOptions) {
    return this.body(options);
  }
}
const options = (controller = new AbortController()): ExecuteOptions => ({
  prompt: 'Request',
  cwd: '/fixture',
  model: 'sonnet',
  abortController: controller,
});
const packet: ProviderMessage = {
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: 'Reply' }] },
};
const registry = (create: () => ControlledProvider) =>
  new ProviderRegistry(
    [{ name: 'claude', create }],
    { isDisconnected: () => false } as never,
    new ApplicationMetrics()
  );

describe('provider query ownership', () => {
  it('forwards parent cancellation while keeping disposal idempotent', async () => {
    const parent = new AbortController();
    const entered = gate();
    let closed = 0;
    const provider = new ControlledProvider(async function* (input) {
      const cancelled = new Promise<void>((resolve) =>
        input.abortController!.signal.addEventListener('abort', () => resolve(), { once: true })
      );
      entered.release();
      try {
        await cancelled;
      } finally {
        closed++;
      }
    });
    const stream = provider.executeQuery(options(parent));
    const next = stream.next().catch((error) => error);
    await entered.promise;
    parent.abort('private reason');
    expect((await next).name).toBe('AbortError');
    await Promise.all([provider.dispose(), provider.dispose()]);
    expect(closed).toBe(1);
  });
  it('keeps start/follow-up on the same managed path and isolates the parent controller', async () => {
    const parent = new AbortController();
    const calls: ExecuteOptions[] = [];
    const provider = new ControlledProvider(async function* (input) {
      calls.push(input);
      yield packet;
    });
    for (const stream of [provider.start(options(parent)), provider.followUp(options(parent))]) {
      expect(await stream.next()).toMatchObject({ value: packet });
      expect(await stream.next()).toMatchObject({ done: true });
    }
    expect(calls).toHaveLength(2);
    expect(calls[0].abortController).not.toBe(parent);
    expect(parent.signal.aborted).toBe(false);
    await provider.dispose();
  });
  it('aborts a pending next before queuing return and waits for asynchronous cleanup', async () => {
    const entered = gate(),
      aborted = gate(),
      cleanup = gate();
    const parent = new AbortController();
    let closed = false;
    const provider = new ControlledProvider(async function* (input) {
      const stopped = new Promise<void>((resolve) =>
        input.abortController!.signal.addEventListener(
          'abort',
          () => {
            aborted.release();
            resolve();
          },
          { once: true }
        )
      );
      entered.release();
      try {
        await stopped;
        yield packet;
      } finally {
        await cleanup.promise;
        closed = true;
      }
    });
    const stream = provider.executeQuery(options(parent));
    const next = stream.next();
    const observed = next.catch((error) => error);
    await entered.promise;
    let returned = false;
    const returning = stream.return(undefined).then(() => {
      returned = true;
    });
    await aborted.promise;
    expect(returned).toBe(false);
    expect(parent.signal.aborted).toBe(false);
    cleanup.release();
    await returning;
    expect((await observed).name).toBe('AbortError');
    expect(closed).toBe(true);
    await provider.dispose();
  });
  it('early return while suspended at a yield waits for cleanup without cancelling its parent', async () => {
    const cleanup = gate();
    const parent = new AbortController();
    const provider = new ControlledProvider(async function* () {
      try {
        yield packet;
      } finally {
        await cleanup.promise;
      }
    });
    const stream = provider.executeQuery(options(parent));
    await stream.next();
    let finished = false;
    const returning = stream.return(undefined).then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    cleanup.release();
    await returning;
    expect(parent.signal.aborted).toBe(false);
  });
  it('does not create an SDK iterator for an already-aborted request or a never-consumed stream', async () => {
    const body = vi.fn(async function* () {
      yield packet;
    });
    const provider = new ControlledProvider(body);
    const parent = new AbortController();
    parent.abort();
    await expect(provider.start(options(parent)).next()).rejects.toMatchObject({
      name: 'AbortError',
    });
    const unused = provider.start(options());
    await unused.return(undefined);
    expect(body).not.toHaveBeenCalled();
    await provider.dispose();
  });
  it('closes all fresh factory instances owned by a registry, with no global cross-app state', async () => {
    const inputs: ExecuteOptions[] = [];
    const create = () =>
      new ControlledProvider(async function* (input) {
        inputs.push(input);
        yield packet;
      });
    const first = registry(create),
      second = registry(create);
    const one = first.byName('claude')!.executeQuery(options());
    const two = first.byName('claude')!.executeQuery(options());
    const other = second.byName('claude')!.executeQuery(options());
    await one.next();
    await two.next();
    await other.next();
    await first.onApplicationShutdown();
    expect(inputs[0].abortController!.signal.aborted).toBe(true);
    expect(inputs[1].abortController!.signal.aborted).toBe(true);
    expect(inputs[2].abortController!.signal.aborted).toBe(false);
    await expect(first.byName('claude')!.executeQuery(options()).next()).rejects.toThrow(
      'not accepting'
    );
    await second.onApplicationShutdown();
  });
  it('refuses a provider instance shared between two application registries', () => {
    const provider = new ControlledProvider(async function* () {
      yield packet;
    });
    registry(() => provider).byName('claude');
    expect(() => registry(() => provider).byName('claude')).toThrow('cannot be shared');
  });
  it('keeps a timed-out lease blocked rather than declaring disposal successful', async () => {
    const scope = new ProviderExecutionScope(20);
    const blocked = gate(),
      entered = gate();
    const body = async function* () {
      entered.release();
      await blocked.promise;
      yield packet;
    };
    const stream = managedProviderStream(options(), body, scope);
    const observed = stream.next().catch((error) => error);
    await entered.promise;
    await expect(scope.dispose()).rejects.toBeInstanceOf(ProviderCleanupError);
    await expect(managedProviderStream(options(), body, scope).next()).rejects.toThrow(
      'not accepting'
    );
    blocked.release();
    expect((await observed).name).toBe('AbortError');
    await expect(scope.dispose()).rejects.toBeInstanceOf(ProviderCleanupError);
  });
  it('retains an unconfirmed cleanup and never exposes raw SDK errors', async () => {
    const scope = new ProviderExecutionScope();
    const iterator = {
      next: async () => ({ done: false as const, value: packet }),
      return: async () => {
        throw new Error('private SDK token');
      },
      throw: async () => ({ done: true as const, value: undefined }),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    const stream = managedProviderStream(options(), () => iterator, scope);
    await stream.next();
    await expect(stream.return(undefined)).rejects.toBeInstanceOf(ProviderCleanupError);
    await expect(scope.dispose()).rejects.not.toThrow('private SDK token');
    await expect(managedProviderStream(options(), () => iterator, scope).next()).rejects.toThrow(
      'not accepting'
    );
  });
  it('allows a new query after an ordinary provider error with verified iterator closure', async () => {
    let calls = 0;
    const provider = new ControlledProvider(async function* () {
      if (!calls++) throw new Error('Rate limit');
      yield packet;
    });
    await expect(provider.executeQuery(options()).next()).rejects.toThrow('Rate limit');
    const second = provider.executeQuery(options());
    expect(await second.next()).toMatchObject({ value: packet });
    await provider.dispose();
  });
});
