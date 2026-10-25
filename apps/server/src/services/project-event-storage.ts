import { atomicWriteJson, type AtomicWriteFilesystem } from '@automaker/utils';
import { UnavailableDomainError } from '../core/errors/domain-errors.js';

export type ProjectEventFilesystem = AtomicWriteFilesystem;

/** One bounded project lane covers reads and complete notification/history mutations. */
export class ProjectEventStorage {
  private readonly tails = new Map<string, Promise<void>>();
  private pending = 0;
  private closing?: Promise<void>;

  constructor(
    readonly filesystem: ProjectEventFilesystem,
    private readonly name: string,
    private readonly canonicalProject: (project: string) => string
  ) {}

  run<T>(project: string, operation: () => Promise<T>): Promise<T> {
    if (this.closing)
      return Promise.reject(new UnavailableDomainError(`${this.name} storage is shutting down.`));
    if (this.pending >= 256)
      return Promise.reject(new UnavailableDomainError(`${this.name} storage is busy.`));
    const key = this.canonicalProject(project);
    const result = (this.tails.get(key) ?? Promise.resolve()).then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined
    );
    this.pending++;
    this.tails.set(key, settled);
    void settled.then(() => {
      this.pending--;
      if (this.tails.get(key) === settled) this.tails.delete(key);
    });
    return result;
  }

  async read<T>(file: string, fallback: T, valid: (value: unknown) => value is T): Promise<T> {
    let content;
    try {
      content = await this.filesystem.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT')
        return globalThis.structuredClone(fallback);
      throw error;
    }
    const value: unknown = JSON.parse(String(content));
    if (!valid(value)) throw new SyntaxError(`Invalid ${this.name} storage document.`);
    return value;
  }

  write(file: string, value: unknown): Promise<void> {
    return atomicWriteJson(file, value, {
      filesystem: this.filesystem,
      recoverableTemporaryFiles: false,
    });
  }

  async remove(file: string): Promise<void> {
    try {
      await this.filesystem.unlink(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    let timer: NodeJS.Timeout;
    this.closing = Promise.race([
      Promise.all([...this.tails.values()]).then(() => undefined),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new UnavailableDomainError(`${this.name} storage cleanup could not be confirmed.`)
            ),
          5000
        );
      }),
    ]).finally(() => clearTimeout(timer));
    return this.closing;
  }
}
