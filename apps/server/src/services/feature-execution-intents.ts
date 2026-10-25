import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { ExecutionFilesystem } from './execution-filesystem.js';
import {
  FeatureExecutionUncertainError,
  FEATURE_UNCERTAIN_REASON,
} from './feature-execution-uncertainty.js';

export type FeatureExecutionPhase = 'execution' | 'pipeline_step' | 'merge';
interface Identity {
  projectPath: string;
  featureId: string;
}
interface Intent extends Identity {
  version: 1;
  operationId: string;
  phase: 'pending' | 'uncertain';
  kind: FeatureExecutionPhase;
  code: 'FEATURE_OUTCOME_UNKNOWN';
  reason: string;
}
/** Private write-ahead barriers, never a source of replay instructions. */
export class FeatureExecutionIntents {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly tails = new Map<string, Promise<unknown>>();
  private closing?: Promise<void>;
  private readonly uncertain = new Set<string>();
  constructor(
    private readonly dataDirectory: string,
    private readonly filesystem: ExecutionFilesystem,
    private readonly canonicalProject: (project: string) => string = path.resolve
  ) {}
  private identity(identity: Identity): Identity {
    return {
      projectPath: this.canonicalProject(identity.projectPath),
      featureId: identity.featureId,
    };
  }
  private file(identity: Identity): string {
    return path.join(
      this.dataDirectory,
      'feature-execution-intents',
      createHash('sha256')
        .update(JSON.stringify([identity.projectPath, identity.featureId]))
        .digest('hex') + '.json'
    );
  }
  private run<T>(
    identity: Identity,
    action: (identity: Identity, file: string) => Promise<T>
  ): Promise<T> {
    if (this.closing || this.pending.size >= 256)
      return Promise.reject(new FeatureExecutionUncertainError());
    const canonical = this.identity(identity),
      file = this.file(canonical);
    const task = (this.tails.get(file) ?? Promise.resolve())
      .catch(() => {})
      .then(() => action(canonical, file));
    const tracked = task.finally(() => {
      this.pending.delete(tracked);
      if (this.tails.get(file) === tracked) this.tails.delete(file);
    });
    this.pending.add(tracked);
    this.tails.set(file, tracked);
    return tracked;
  }
  private async read(file: string): Promise<Intent | undefined> {
    try {
      const entry = await this.filesystem.lstat(file);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 8192)
        throw new FeatureExecutionUncertainError();
      const value = JSON.parse(String(await this.filesystem.readFile(file, 'utf-8'))) as Intent;
      if (
        value.version !== 1 ||
        !['pending', 'uncertain'].includes(value.phase) ||
        !['execution', 'pipeline_step', 'merge'].includes(value.kind) ||
        typeof value.operationId !== 'string' ||
        typeof value.projectPath !== 'string' ||
        typeof value.featureId !== 'string' ||
        value.code !== 'FEATURE_OUTCOME_UNKNOWN' ||
        value.reason !== FEATURE_UNCERTAIN_REASON
      )
        throw new FeatureExecutionUncertainError();
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      this.uncertain.add(file);
      throw new FeatureExecutionUncertainError();
    }
  }
  assertAllowed(identity: Identity): Promise<void> {
    return this.run(identity, async (_identity, file) => {
      if (await this.read(file)) {
        this.uncertain.add(file);
        throw new FeatureExecutionUncertainError();
      }
    });
  }
  begin(identity: Identity, kind: FeatureExecutionPhase): Promise<string> {
    return this.run(identity, async (canonical, file) => {
      if (await this.read(file)) {
        this.uncertain.add(file);
        throw new FeatureExecutionUncertainError();
      }
      const operationId = randomUUID();
      await this.write(file, {
        ...canonical,
        version: 1,
        operationId,
        phase: 'pending',
        kind,
        code: 'FEATURE_OUTCOME_UNKNOWN',
        reason: FEATURE_UNCERTAIN_REASON,
      });
      return operationId;
    });
  }
  private async write(file: string, value: Intent): Promise<void> {
    await this.filesystem.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.tmp.' + randomUUID();
    try {
      await this.filesystem.writeFile(temporary, JSON.stringify(value), {
        encoding: 'utf-8',
        mode: 0o600,
        flag: 'wx',
      });
      await this.filesystem.rename(temporary, file);
    } finally {
      await this.filesystem.unlink(temporary).catch(() => {});
    }
  }
  settle(identity: Identity, operationId: string): Promise<void> {
    return this.run(identity, async (_identity, file) => {
      const value = await this.read(file);
      if (!value || value.operationId !== operationId) {
        this.uncertain.add(file);
        throw new FeatureExecutionUncertainError();
      }
      await this.filesystem.unlink(file);
      this.uncertain.delete(file);
    });
  }
  markUncertain(identity: Identity, operationId: string): Promise<void> {
    return this.run(identity, async (_identity, file) => {
      this.uncertain.add(file);
      const value = await this.read(file);
      if (!value || value.operationId !== operationId) throw new FeatureExecutionUncertainError();
      await this.write(file, { ...value, phase: 'uncertain' });
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    const accepted = [...this.pending],
      deadline = performance.now() + 5000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.closing = Promise.race([
      Promise.allSettled(accepted).then((results) => {
        if (
          this.uncertain.size > 0 ||
          performance.now() >= deadline ||
          results.some((result) => result.status === 'rejected')
        )
          throw new FeatureExecutionUncertainError();
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new FeatureExecutionUncertainError()), 5000);
      }),
    ]).finally(() => clearTimeout(timer));
    return this.closing;
  }
}
