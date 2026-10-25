import { describe, expect, it } from 'vitest';
import { AgentExecutionCoordinator } from '../../../src/services/agent/agent-execution-coordinator.js';
import {
  ConflictDomainError,
  UnavailableDomainError,
} from '../../../src/core/errors/domain-errors.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('AgentExecutionCoordinator', () => {
  it.each([' one', 'one ', '../one'])(
    'rejects noncanonical storage/execution identity %j',
    (id) => {
      const coordinator = new AgentExecutionCoordinator();
      expect(() => coordinator.run(id, async () => undefined)).toThrow(
        'Invalid agent session identifier'
      );
      expect(() => coordinator.mutate(id, async () => undefined)).toThrow(
        'Invalid agent session identifier'
      );
    }
  );

  it('reserves before async preparation, while allowing another session/application', async () => {
    const coordinator = new AgentExecutionCoordinator();
    const pending = gate();
    const first = coordinator.run('one', async () => {
      await pending.promise;
      return 'first';
    });
    expect(() => coordinator.run('one', async () => 'duplicate')).toThrow(ConflictDomainError);
    expect(await coordinator.run('two', async () => 'other session')).toBe('other session');
    expect(await new AgentExecutionCoordinator().run('one', async () => 'other app')).toBe(
      'other app'
    );
    pending.release();
    expect(await first).toBe('first');
    expect(await coordinator.run('one', async () => 'next')).toBe('next');
  });

  it('holds a destructive barrier until abort cleanup has actually settled', async () => {
    const coordinator = new AgentExecutionCoordinator();
    const cleanup = gate(),
      started = gate(),
      aborted = gate();
    const first = coordinator.run('one', async (controller) => {
      controller.signal.addEventListener('abort', aborted.release, { once: true });
      started.release();
      await cleanup.promise;
    });
    await started.promise;
    let mutated = false;
    const mutation = coordinator.mutate('one', async () => {
      mutated = true;
    });
    await aborted.promise;
    expect(mutated).toBe(false);
    expect(() => coordinator.run('one', async () => undefined)).toThrow(ConflictDomainError);
    cleanup.release();
    await Promise.all([first, mutation]);
    expect(mutated).toBe(true);
  });

  it('keeps the old run reserved after a drain timeout and never performs the mutation', async () => {
    const coordinator = new AgentExecutionCoordinator(20);
    const pending = gate();
    const first = coordinator.run('one', () => pending.promise);
    let mutated = false;
    await expect(
      coordinator.mutate('one', async () => {
        mutated = true;
      })
    ).rejects.toBeInstanceOf(UnavailableDomainError);
    expect(mutated).toBe(false);
    expect(coordinator.has('one')).toBe(true);
    expect(() => coordinator.run('one', async () => undefined)).toThrow(ConflictDomainError);
    pending.release();
    await first;
    expect(await coordinator.run('one', async () => 'safe next run')).toBe('safe next run');
  });

  it('rejects model mutation without aborting the active run', async () => {
    const coordinator = new AgentExecutionCoordinator();
    const pending = gate(),
      started = gate();
    let signal!: AbortSignal;
    const first = coordinator.run('one', async (controller) => {
      signal = controller.signal;
      started.release();
      await pending.promise;
    });
    await started.promise;
    await expect(coordinator.mutate('one', async () => undefined, false)).rejects.toBeInstanceOf(
      ConflictDomainError
    );
    expect(signal.aborted).toBe(false);
    pending.release();
    await first;
  });

  it('releases failed work/mutations without poisoning later admission', async () => {
    const coordinator = new AgentExecutionCoordinator();
    await expect(
      coordinator.run('one', async () => {
        throw new Error('fixture');
      })
    ).rejects.toThrow('fixture');
    await expect(
      coordinator.mutate('one', async () => {
        throw new Error('mutation');
      })
    ).rejects.toThrow('mutation');
    expect(await coordinator.run('one', async () => 'next')).toBe('next');
  });

  it('quiesces admission immediately and drains the active run before shutdown resolves', async () => {
    const coordinator = new AgentExecutionCoordinator();
    const pending = gate(),
      started = gate(),
      aborted = gate();
    const first = coordinator.run('one', async (controller) => {
      controller.signal.addEventListener('abort', aborted.release, { once: true });
      started.release();
      await pending.promise;
    });
    await started.promise;
    const closing = coordinator.onApplicationShutdown();
    await aborted.promise;
    expect(() => coordinator.run('two', async () => undefined)).toThrow(UnavailableDomainError);
    pending.release();
    await Promise.all([first, closing]);
    expect(coordinator.ids()).toEqual([]);
  });
});
