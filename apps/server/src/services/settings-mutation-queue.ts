import { UnavailableDomainError } from '../core/errors/index.js';

/** Serializes complete settings transactions, including reads and backup rotation. */
export class SettingsMutationQueue {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly pending = new Set<Promise<unknown>>();
  private closing = false;
  private closeResult?: Promise<void>;

  constructor(
    private readonly capacity = 256,
    private readonly drainMs = 5000
  ) {}

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (this.closing)
      return Promise.reject(new UnavailableDomainError('Settings storage is shutting down.'));
    if (this.pending.size >= this.capacity)
      return Promise.reject(new UnavailableDomainError('Settings storage is busy.'));
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined
    );
    this.tails.set(key, settled);
    this.pending.add(settled);
    void settled.then(() => {
      this.pending.delete(settled);
      if (this.tails.get(key) === settled) this.tails.delete(key);
    });
    return result;
  }

  close(): Promise<void> {
    if (this.closeResult) return this.closeResult;
    this.closing = true;
    this.closeResult = new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () =>
          reject(new UnavailableDomainError('Settings storage cleanup could not be confirmed.')),
        this.drainMs
      );
      void Promise.allSettled([...this.pending]).then(() => {
        clearTimeout(deadline);
        resolve();
      });
    });
    return this.closeResult;
  }
}
