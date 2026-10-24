import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { atomicWriteJson, DEFAULT_BACKUP_COUNT } from '@automaker/utils';
import { getAutomakerDir, getFeaturesDir } from '@automaker/platform';
import type { Feature, BacklogPlanResult } from '@automaker/types';
import type * as Filesystem from '../../lib/secure-fs.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';
import { UnavailableDomainError, ValidationDomainError } from '../../core/errors/index.js';
import { streamingQuery } from '../../providers/simple-query-service.js';

export interface StoredBacklogPlan {
  savedAt: string;
  prompt: string;
  model?: string;
  result: BacklogPlanResult;
}
export interface PlanningRunContext {
  projectPath: string;
  check(): void;
  filesystem: Pick<typeof Filesystem, 'readFile'>;
  query: typeof streamingQuery;
  features: { getAll(projectPath: string): Promise<Feature[]> };
  ensureDirectory(projectPath: string): Promise<void>;
  writeText(file: string, text: string): Promise<void>;
  writeFeature(projectPath: string, feature: Partial<Feature> & { id: string }): Promise<void>;
  savePlan(projectPath: string, plan: StoredBacklogPlan): Promise<void>;
}

/** One application's native IO/query boundary; each run has an explicit cancellation context. */
@Injectable()
export class PlanningWorkflowContext {
  constructor(
    @Inject(SECURE_FILESYSTEM) private readonly filesystem: typeof Filesystem,
    @Inject(SecurityService) private readonly security: SecurityService
  ) {}

  operation(project: string, signal: AbortSignal): PlanningRunContext {
    const projectPath = this.security.validateLocalPath(project, 'planning workflow');
    const check = () => signal.throwIfAborted();
    const owned = async <T>(operation: () => Promise<T>): Promise<T> => {
      check();
      const result = await operation();
      check();
      return result;
    };
    const same = (candidate: string) => {
      if (this.security.validateLocalPath(candidate, 'planning workflow') !== projectPath)
        throw new ValidationDomainError('Planning operation changed its project.');
    };
    return {
      projectPath,
      check,
      filesystem: { readFile: (...args) => owned(() => this.filesystem.readFile(...args)) },
      query: (...args) => owned(() => streamingQuery(...args)),
      features: {
        getAll: (candidate) => {
          same(candidate);
          return owned(() => this.features(projectPath, check));
        },
      },
      ensureDirectory: (candidate) => {
        same(candidate);
        return owned(() =>
          this.filesystem.mkdir(getAutomakerDir(projectPath), { recursive: true, mode: 0o700 })
        ).then(() => undefined);
      },
      writeText: (file, content) => owned(() => this.text(file, content)),
      writeFeature: (candidate, feature) => {
        same(candidate);
        return owned(async () => {
          if (
            !feature.id ||
            feature.id.length > 255 ||
            feature.id === '.' ||
            feature.id === '..' ||
            /[/\\\0]/.test(feature.id)
          )
            throw new ValidationDomainError('Invalid generated feature identifier.');
          const file = path.join(getFeaturesDir(projectPath), feature.id, 'feature.json');
          await atomicWriteJson(file, feature, {
            backupCount: DEFAULT_BACKUP_COUNT,
            filesystem: this.filesystem,
            mode: 0o600,
          });
        });
      },
      savePlan: (candidate, plan) => {
        same(candidate);
        return owned(() => this.save(projectPath, plan));
      },
    };
  }

  private async features(project: string, check: () => void): Promise<Feature[]> {
    const directory = getFeaturesDir(project);
    let entries;
    try {
      entries = await this.filesystem.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const result: Feature[] = [];
    for (const entry of entries) {
      check();
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      let data;
      try {
        data = await this.filesystem.readFile(
          path.join(directory, entry.name, 'feature.json'),
          'utf8'
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      let feature: Feature;
      try {
        feature = JSON.parse(String(data));
      } catch {
        throw new UnavailableDomainError('Project feature storage is unavailable.');
      }
      if (
        !feature ||
        typeof feature !== 'object' ||
        Array.isArray(feature) ||
        typeof feature.id !== 'string'
      )
        throw new UnavailableDomainError('Project feature storage is unavailable.');
      delete feature.titleGenerating;
      result.push(feature);
    }
    return result.sort(
      (a, b) => parseInt(a.id.split('-')[1] || '0') - parseInt(b.id.split('-')[1] || '0')
    );
  }

  private async text(file: string, content: string): Promise<void> {
    const target = this.security.validateLocalPath(file, 'planning output');
    const temporary = `${target}.tmp.${Date.now()}.${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    await this.filesystem.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    try {
      await this.filesystem.writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
      await this.filesystem.rename(temporary, target);
    } catch (error) {
      await this.filesystem.rm(temporary, { force: true });
      throw error;
    }
  }

  private file(project: string): string {
    return path.join(
      getAutomakerDir(this.security.validateLocalPath(project, 'backlog plan')),
      'backlog-plan.json'
    );
  }
  async save(project: string, plan: StoredBacklogPlan): Promise<void> {
    await atomicWriteJson(this.file(project), plan, {
      backupCount: DEFAULT_BACKUP_COUNT,
      filesystem: this.filesystem,
      mode: 0o600,
    });
  }
  async load(project: string): Promise<StoredBacklogPlan | null> {
    let bytes;
    try {
      bytes = await this.filesystem.readFile(this.file(project), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      const value = JSON.parse(String(bytes)) as StoredBacklogPlan;
      if (!Array.isArray(value?.result?.changes)) throw new Error();
      return value;
    } catch {
      throw new UnavailableDomainError('Saved backlog plan is unavailable.');
    }
  }
  async clear(project: string): Promise<void> {
    try {
      await this.filesystem.unlink(this.file(project));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
