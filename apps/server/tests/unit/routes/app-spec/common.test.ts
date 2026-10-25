import { describe, it, expect, vi } from 'vitest';
import { getErrorMessage } from '@automaker/utils';
import { AppSpecJobRegistry } from '@/modules/app-spec/app-spec-job.registry.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
const registry = () =>
  new AppSpecJobRegistry({
    validateLocalPath: (value: string) => value.replace('/alias', '/project'),
  } as never);
describe('native app-spec project-scoped job ownership', () => {
  it('publishes running admission immediately and clears only after the accepted operation settles', async () => {
    const jobs = registry(),
      held = deferred();
    expect(jobs.run('/project', 'spec_regeneration', () => held.promise)).toBe(true);
    expect(jobs.status('/project').isRunning).toBe(true);
    expect(jobs.status().isRunning).toBe(true);
    held.resolve();
    await jobs.onModuleDestroy();
    expect(jobs.status('/project').isRunning).toBe(false);
  });
  it('keeps the original abort controller while a duplicate/alias admission is rejected', async () => {
    const jobs = registry(),
      held = deferred();
    let original!: AbortController;
    jobs.run('/project', 'spec_regeneration', async (controller) => {
      original = controller;
      await held.promise;
    });
    await Promise.resolve();
    expect(jobs.run('/alias', 'feature_generation', async () => {})).toBe(false);
    jobs.stop('/alias');
    expect(original.signal.aborted).toBe(true);
    expect(jobs.status('/project').isRunning).toBe(true);
    held.resolve();
    await jobs.onModuleDestroy();
    expect(jobs.snapshot()).toEqual([]);
  });
  it('cancels only the selected project while other scoped work remains admitted', async () => {
    const jobs = registry(),
      one = deferred(),
      two = deferred();
    let a!: AbortSignal, b!: AbortSignal;
    jobs.run('/project', 'spec_regeneration', async (c) => {
      a = c.signal;
      await one.promise;
    });
    jobs.run('/other', 'sync', async (c) => {
      b = c.signal;
      await two.promise;
    });
    await Promise.resolve();
    jobs.stop('/project');
    expect(a.aborted).toBe(true);
    expect(b.aborted).toBe(false);
    expect(jobs.status('/other').isRunning).toBe(true);
    one.resolve();
    two.resolve();
    await jobs.onModuleDestroy();
  });
  it('isolates identical project names across separate application registries', async () => {
    const one = registry(),
      two = registry(),
      a = deferred(),
      b = deferred();
    let signal!: AbortSignal;
    one.run('/project', 'spec_regeneration', () => a.promise);
    two.run('/project', 'feature_generation', async (c) => {
      signal = c.signal;
      await b.promise;
    });
    await Promise.resolve();
    one.stop();
    expect(signal.aborted).toBe(false);
    expect(two.status('/project').isRunning).toBe(true);
    a.resolve();
    b.resolve();
    await Promise.all([one.onModuleDestroy(), two.onModuleDestroy()]);
  });
  it('allows a later incarnation after completion and rejects admission after close', async () => {
    const jobs = registry();
    const first = deferred();
    jobs.run('/project', 'sync', () => first.promise);
    first.resolve();
    await vi.waitFor(() => expect(jobs.status('/project').isRunning).toBe(false));
    const second = deferred();
    expect(jobs.run('/project', 'feature_generation', () => second.promise)).toBe(true);
    const close = jobs.onModuleDestroy();
    second.resolve();
    await close;
    expect(() => jobs.run('/project', 'sync', async () => {})).toThrow('unavailable');
  });
});
describe('shared error message utility', () => {
  describe('getErrorMessage', () => {
    it('should return message from Error instance', () => {
      const error = new Error('Test error message');
      expect(getErrorMessage(error)).toBe('Test error message');
    });

    it("should return 'Unknown error' for non-Error objects", () => {
      expect(getErrorMessage('string error')).toBe('Unknown error');
      expect(getErrorMessage(123)).toBe('Unknown error');
      expect(getErrorMessage(null)).toBe('Unknown error');
      expect(getErrorMessage(undefined)).toBe('Unknown error');
      expect(getErrorMessage({})).toBe('Unknown error');
      expect(getErrorMessage([])).toBe('Unknown error');
    });

    it('should return message from Error with empty message', () => {
      const error = new Error('');
      expect(getErrorMessage(error)).toBe('');
    });

    it('should handle Error objects with custom properties', () => {
      const error = new Error('Base message');
      (error as any).customProp = 'custom value';
      expect(getErrorMessage(error)).toBe('Base message');
    });

    it('should handle Error objects created with different constructors', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const customError = new CustomError('Custom error message');
      expect(getErrorMessage(customError)).toBe('Custom error message');
    });
  });
});
