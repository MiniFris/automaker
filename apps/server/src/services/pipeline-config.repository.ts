import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { PipelineConfig } from '@automaker/types';
import type * as SecureFilesystem from '../lib/secure-fs.js';
import { UnavailableDomainError } from '../core/errors/domain-errors.js';

export abstract class PipelineConfigurationRepository {
  abstract read(projectPath: string): Promise<PipelineConfig>;
  abstract save(projectPath: string, config: PipelineConfig): Promise<void>;
  abstract update<T>(projectPath: string, mutation: (config: PipelineConfig) => T): Promise<T>;
}

type Filesystem = Pick<typeof SecureFilesystem, 'readFile' | 'writeFile' | 'rename' | 'unlink'>;
interface RepositoryOptions {
  strictRead?: boolean;
  maxAccepted?: number;
  shutdownTimeoutMs?: number;
}

export class PipelineConfigurationCleanupError extends Error {
  readonly code = 'PIPELINE_CONFIGURATION_CLEANUP_FAILED';
  constructor() {
    super('Pipeline configuration cleanup could not be confirmed.');
  }
}

/** One application owns its canonical project queues and accepted config writes. */
export class FilePipelineConfigurationRepository extends PipelineConfigurationRepository {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly accepted = new Set<Promise<unknown>>();
  private stopping = false;
  private shutdown?: Promise<void>;

  constructor(
    private readonly filesystem: Filesystem,
    private readonly ensureDirectory: (projectPath: string) => Promise<unknown>,
    private readonly canonicalProject: (projectPath: string) => string = path.resolve,
    private readonly options: RepositoryOptions = {}
  ) {
    super();
  }

  read(projectPath: string): Promise<PipelineConfig> {
    return this.run(projectPath, (canonical) => this.readUnlocked(canonical));
  }

  save(projectPath: string, config: PipelineConfig): Promise<void> {
    const snapshot = globalThis.structuredClone(config);
    return this.run(projectPath, (canonical) => this.writeUnlocked(canonical, snapshot));
  }

  update<T>(projectPath: string, mutation: (config: PipelineConfig) => T): Promise<T> {
    return this.run(projectPath, async (canonical) => {
      const config = await this.readUnlocked(canonical);
      const result = await mutation(config);
      await this.writeUnlocked(canonical, config);
      return result;
    });
  }

  private run<T>(projectPath: string, operation: (canonical: string) => Promise<T>): Promise<T> {
    if (this.stopping) throw new UnavailableDomainError('Pipeline configuration is shutting down.');
    if (this.accepted.size >= (this.options.maxAccepted ?? Infinity))
      throw new UnavailableDomainError('Pipeline configuration is busy.');
    const canonical = this.canonicalProject(projectPath);
    const previous = this.queues.get(canonical) ?? Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(() => operation(canonical))
      .finally(() => {
        this.accepted.delete(task);
        if (this.queues.get(canonical) === task) this.queues.delete(canonical);
      });
    this.accepted.add(task);
    this.queues.set(canonical, task);
    return task;
  }

  private async readUnlocked(projectPath: string): Promise<PipelineConfig> {
    let content: string;
    try {
      content = (await this.filesystem.readFile(
        path.join(projectPath, '.automaker', 'pipeline.json'),
        'utf-8'
      )) as string;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || !this.options.strictRead)
        return { version: 1, steps: [] };
      throw error;
    }
    try {
      const config = JSON.parse(content) as Partial<PipelineConfig>;
      return { version: 1, steps: [], ...config };
    } catch {
      // Retain the existing missing/malformed-file compatibility behavior.
      return { version: 1, steps: [] };
    }
  }

  private async writeUnlocked(projectPath: string, config: PipelineConfig): Promise<void> {
    await this.ensureDirectory(projectPath);
    const target = path.join(projectPath, '.automaker', 'pipeline.json');
    const temporary = `${target}.tmp.${randomUUID()}`;
    try {
      await this.filesystem.writeFile(temporary, JSON.stringify(config, null, 2), 'utf-8');
      await this.filesystem.rename(temporary, target);
    } catch (error) {
      await this.filesystem.unlink(temporary).catch(() => {});
      throw error;
    }
  }

  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    const timeoutMs = this.options.shutdownTimeoutMs ?? 5000;
    const deadline = performance.now() + timeoutMs;
    let timer: NodeJS.Timeout | undefined;
    this.shutdown = Promise.race([
      Promise.allSettled([...this.accepted]).then(() => {
        if (performance.now() >= deadline) throw new PipelineConfigurationCleanupError();
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new PipelineConfigurationCleanupError()), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    return this.shutdown;
  }
}
