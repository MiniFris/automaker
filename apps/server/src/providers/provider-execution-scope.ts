import { UnavailableDomainError } from '../core/errors/domain-errors.js';
import type { ExecuteOptions, ProviderMessage } from './types.js';

export class ProviderCleanupError extends UnavailableDomainError {
  constructor() {
    super('Provider cleanup is unconfirmed. No replacement query was started.');
  }
}

interface Lease {
  controller: AbortController;
  done: Promise<void>;
  close: () => Promise<unknown>;
  unconfirmed: boolean;
  failed: boolean;
  cancelled: boolean;
}

async function closeProviderIterator(
  iterator: AsyncGenerator<ProviderMessage> | undefined,
  lease: Lease
): Promise<void> {
  try {
    await iterator?.return(undefined);
  } catch {
    lease.unconfirmed = true;
    // Cleanup uncertainty takes precedence over a normal model/API error.
    throw new ProviderCleanupError();
  }
}

/** Application/adapter-owned query leases, not a global provider singleton. */
export class ProviderExecutionScope {
  private readonly leases = new Set<Lease>();
  private accepting = true;
  private disposal?: Promise<void>;
  constructor(
    private readonly drainTimeoutMs = 5000,
    private readonly observe?: () => (result: {
      failed: boolean;
      cancelled: boolean;
      unconfirmed: boolean;
    }) => void
  ) {}

  admit(lease: Lease): () => void {
    if (!this.accepting || [...this.leases].some((item) => item.unconfirmed))
      throw new UnavailableDomainError('Provider execution is not accepting new queries.');
    this.leases.add(lease);
    let finishObservation: ReturnType<NonNullable<typeof this.observe>> | undefined;
    try {
      finishObservation = this.observe?.();
    } catch {
      /* Telemetry cannot change execution ownership. */
    }
    void lease.done.then(() => {
      try {
        finishObservation?.({
          failed: lease.failed,
          cancelled: lease.cancelled,
          unconfirmed: lease.unconfirmed,
        });
      } catch {
        /* Telemetry failures must not become unhandled query failures. */
      }
    });
    return () => this.leases.delete(lease);
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.accepting = false;
    this.disposal = this.drain();
    return this.disposal;
  }

  private async drain(): Promise<void> {
    const leases = [...this.leases];
    for (const lease of leases) {
      lease.controller.abort();
      void lease.close().catch(() => undefined);
    }
    if (!leases.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(leases.map((lease) => lease.done)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new ProviderCleanupError()), this.drainTimeoutMs);
        }),
      ]);
      if (leases.some((lease) => lease.unconfirmed)) throw new ProviderCleanupError();
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Abort before queuing return(): an async generator may be blocked inside next(). */
export function managedProviderStream(
  options: ExecuteOptions,
  execute: (options: ExecuteOptions) => AsyncGenerator<ProviderMessage>,
  scope: ProviderExecutionScope,
  owner?: ProviderExecutionScope,
  cancellationMessages?: readonly ProviderMessage[]
): AsyncGenerator<ProviderMessage> {
  const controller = new AbortController();
  const parent = options.abortController?.signal;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const lease: Lease = {
    controller,
    done,
    close: () => stream.return(undefined),
    unconfirmed: false,
    failed: false,
    cancelled: false,
  };
  const generator = (async function* () {
    const release = scope.admit(lease);
    let releaseOwner: (() => void) | undefined;
    let iterator: AsyncGenerator<ProviderMessage> | undefined;
    let completed = false;
    const abort = () => controller.abort();
    try {
      releaseOwner = owner?.admit(lease);
      if (parent?.aborted) abort();
      else parent?.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted && cancellationMessages) {
        yield* cancellationMessages;
        return;
      }
      controller.signal.throwIfAborted();
      iterator = execute({ ...options, abortController: controller });
      while (true) {
        const result = await iterator.next();
        if (controller.signal.aborted && !cancellationMessages) controller.signal.throwIfAborted();
        if (
          controller.signal.aborted &&
          cancellationMessages &&
          !result.done &&
          !['error', 'result'].includes(result.value.type)
        ) {
          yield* cancellationMessages;
          return;
        }
        if (result.done) {
          completed = true;
          return result.value;
        }
        yield result.value;
      }
    } catch (error) {
      lease.failed = true;
      if (error instanceof ProviderCleanupError) lease.unconfirmed = true;
      throw error;
    } finally {
      lease.cancelled = controller.signal.aborted || (!completed && !lease.failed);
      if (!completed) controller.abort();
      try {
        await closeProviderIterator(iterator, lease);
      } finally {
        parent?.removeEventListener('abort', abort);
        if (!lease.unconfirmed) {
          release();
          releaseOwner?.();
        }
        finish();
      }
    }
  })();
  const stream: AsyncGenerator<ProviderMessage> = {
    next: (...args) => generator.next(...args),
    return: (value) => {
      controller.abort();
      return generator.return(value);
    },
    throw: (error) => {
      controller.abort();
      return generator.throw(error);
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  return stream;
}
