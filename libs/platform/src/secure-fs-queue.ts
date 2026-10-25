import { performance } from 'node:perf_hooks';

export class SecureFsAdmissionError extends Error {
  constructor(readonly code: 'FILESYSTEM_CLOSED' | 'FILESYSTEM_BUSY') {
    super(code === 'FILESYSTEM_CLOSED' ? 'Filesystem is closing.' : 'Filesystem is busy.');
  }
}

export class SecureFsCleanupError extends Error {
  readonly code = 'FILESYSTEM_CLEANUP_UNCONFIRMED';
  constructor() {
    super('Filesystem cleanup could not be confirmed.');
  }
}

export interface SecureFsLifecycleOptions {
  /** Total accepted public operations (active plus queued). */
  maxOperations?: number;
  shutdownTimeoutMs?: number;
}

interface Job {
  operation: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/** Owns complete public operations, including compound read/modify/write helpers. */
export class SecureFsQueue {
  private readonly queued = new Set<Job>();
  private readonly active = new Set<Job>();
  private readonly stopping = new AbortController();
  private readonly maxOperations: number;
  private readonly timeoutMs: number;
  private concurrency = 100;
  private shutdown?: Promise<void>;
  private finishShutdown?: () => void;

  constructor(options: SecureFsLifecycleOptions = {}) {
    this.maxOperations = options.maxOperations ?? 1024;
    this.timeoutMs = options.shutdownTimeoutMs ?? 5000;
    if (
      !(
        this.maxOperations === Infinity ||
        (Number.isSafeInteger(this.maxOperations) && this.maxOperations > 0)
      ) ||
      !Number.isFinite(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 30_000
    )
      throw new TypeError('Invalid filesystem lifecycle configuration.');
  }

  get activeCount(): number {
    return this.active.size;
  }
  get pendingCount(): number {
    return this.queued.size;
  }

  assertOpen(): void {
    if (this.stopping.signal.aborted) throw new SecureFsAdmissionError('FILESYSTEM_CLOSED');
  }

  configureConcurrency(value: number): void {
    this.assertOpen();
    if (!(value === Infinity || (Number.isInteger(value) && value > 0)))
      throw new TypeError('Filesystem concurrency must be a positive integer.');
    if (this.active.size || this.queued.size)
      throw new Error('Cannot change filesystem concurrency while operations are in flight.');
    this.concurrency = value;
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      this.assertOpen();
      if (this.active.size + this.queued.size >= this.maxOperations)
        throw new SecureFsAdmissionError('FILESYSTEM_BUSY');
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise<T>((resolve, reject) => {
      this.queued.add({ operation, resolve: (value) => resolve(value as T), reject });
      this.pump();
    });
  }

  private pump(): void {
    while (
      !this.stopping.signal.aborted &&
      this.active.size < this.concurrency &&
      this.queued.size
    ) {
      const job = this.queued.values().next().value!;
      this.queued.delete(job);
      this.active.add(job);
      void Promise.resolve()
        .then(() => {
          this.assertOpen();
          return job.operation();
        })
        .then(
          (value) => {
            this.settled(job);
            job.resolve(value);
          },
          (error) => {
            this.settled(job);
            job.reject(error);
          }
        );
    }
  }

  private settled(job: Job): void {
    this.active.delete(job);
    this.pump();
    this.finishShutdown?.();
  }

  async retryDelay(milliseconds: number): Promise<void> {
    this.assertOpen();
    await new Promise<void>((resolve, reject) => {
      const signal = this.stopping.signal;
      const cancel = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        reject(new SecureFsAdmissionError('FILESYSTEM_CLOSED'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        resolve();
      }, milliseconds);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
    this.assertOpen();
  }

  close(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    const deadline = performance.now() + this.timeoutMs;
    let resolve!: () => void, reject!: (error: unknown) => void;
    // Cache before abort/reject callbacks can re-enter close().
    this.shutdown = new Promise<void>((done, failed) => {
      resolve = done;
      reject = failed;
    });
    const timer = setTimeout(() => {
      this.finishShutdown = undefined;
      reject(new SecureFsCleanupError());
    }, this.timeoutMs);
    this.finishShutdown = () => {
      if (this.active.size || this.queued.size) return;
      clearTimeout(timer);
      this.finishShutdown = undefined;
      if (performance.now() >= deadline) reject(new SecureFsCleanupError());
      else resolve();
    };
    for (const job of this.queued) job.reject(new SecureFsAdmissionError('FILESYSTEM_CLOSED'));
    this.queued.clear();
    this.stopping.abort();
    this.finishShutdown?.();
    return this.shutdown;
  }
}
