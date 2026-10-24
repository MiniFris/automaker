import type { INestApplication } from '@nestjs/common';
import { ShutdownSignal } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { constants as osConstants } from 'node:os';

export class ApplicationCleanupError extends Error {
  readonly code = 'APPLICATION_CLEANUP_FAILED';
  constructor() {
    super('Application cleanup could not be confirmed.');
  }
}

/** Nest 12 logs hook failures and continues. Preserve cleanup attempts, but not a false success. */
export function manageApplicationShutdown(app: INestApplication): { enableSignals(): void } {
  let failed = false;
  const seen = new Set<object>();
  for (const module of app.get(ModulesContainer).values()) {
    for (const collection of [
      module.providers,
      module.controllers,
      module.injectables,
      module.middlewares,
    ]) {
      for (const wrapper of collection.values()) {
        const instance = wrapper.instance as Record<string, unknown> | undefined;
        if (!instance || seen.has(instance)) continue;
        seen.add(instance);
        for (const name of [
          'onModuleDestroy',
          'beforeApplicationShutdown',
          'onApplicationShutdown',
        ]) {
          const hook = instance[name];
          if (typeof hook !== 'function') continue;
          instance[name] = async (...args: unknown[]) => {
            try {
              return await hook.apply(instance, args);
            } catch {
              failed = true;
              throw new ApplicationCleanupError();
            }
          };
        }
      }
    }
  }
  // NestFactory proxies resolve methods lazily (and their set trap is not assignment).
  // Capture the public close implementation, not a proxy thunk that would recurse.
  let prototype: object | null = app;
  let implementation: ((signal?: string) => Promise<void>) | undefined;
  while (prototype && !implementation) {
    const value = Object.getOwnPropertyDescriptor(prototype, 'close')?.value;
    if (typeof value === 'function') implementation = value;
    prototype = Object.getPrototypeOf(prototype);
  }
  if (!implementation) throw new ApplicationCleanupError();
  const nativeClose = implementation.bind(app);
  const handlers = new Map<NodeJS.Signals, () => void>();
  let closing: Promise<void> | undefined;
  let signalled = false;
  const close = (signal?: string) => {
    closing ??= Promise.resolve()
      .then(() => nativeClose(signal))
      .then(() => {
        try {
          const adapter = app.getHttpAdapter?.() as
            | { assertCleanupConfirmed?: () => void }
            | undefined;
          adapter?.assertCleanupConfirmed?.();
        } catch {
          throw new ApplicationCleanupError();
        }
        if (failed) throw new ApplicationCleanupError();
      })
      .finally(() => {
        for (const [name, listener] of handlers) process.removeListener(name, listener);
        handlers.clear();
      });
    return closing;
  };
  Object.defineProperty(app, 'close', { value: close, configurable: true, writable: true });
  return {
    enableSignals() {
      if (handlers.size || closing) return;
      for (const name of Object.values(ShutdownSignal)) {
        if (!Object.hasOwn(osConstants.signals, name)) continue;
        const signal = name as NodeJS.Signals;
        const listener = () => {
          if (signalled) return;
          signalled = true;
          const watchdog = setTimeout(() => process.exit(1), 30_000);
          void close(signal).then(
            () => {
              clearTimeout(watchdog);
              process.exit(0);
            },
            () => {
              clearTimeout(watchdog);
              process.exit(1);
            }
          );
        };
        handlers.set(signal, listener);
        process.on(signal, listener);
      }
    },
  };
}
