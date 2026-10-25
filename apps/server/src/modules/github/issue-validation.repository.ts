import { Injectable } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { UnavailableDomainError } from '../../core/errors/domain-errors.js';
import {
  writeValidation,
  getAllValidations,
  getValidationWithFreshness,
  deleteValidation,
  markValidationViewed,
  type StoredValidation,
  type ValidationFilesystem,
} from '../../lib/validation-storage.js';

/** Native storage adapter; existing project-scoped files remain authoritative. */
@Injectable()
export class IssueValidationRepository {
  private readonly lanes = new Map<string, Promise<void>>();
  private readonly pending = new Set<Promise<unknown>>();
  private stopping = false;
  private shutdown?: Promise<void>;

  constructor(
    private readonly filesystem: ValidationFilesystem,
    private readonly canonicalProject: (projectPath: string) => string
  ) {}

  write(projectPath: string, issueNumber: number, validation: StoredValidation) {
    return this.transaction(projectPath, (project) =>
      writeValidation(project, issueNumber, validation, this.filesystem)
    );
  }
  list(projectPath: string) {
    return this.transaction(projectPath, (project) => getAllValidations(project, this.filesystem));
  }
  get(projectPath: string, issueNumber: number) {
    return this.transaction(projectPath, (project) =>
      getValidationWithFreshness(project, issueNumber, this.filesystem)
    );
  }
  delete(projectPath: string, issueNumber: number) {
    return this.transaction(projectPath, (project) =>
      deleteValidation(project, issueNumber, this.filesystem)
    );
  }
  markViewed(projectPath: string, issueNumber: number) {
    return this.transaction(projectPath, (project) =>
      markValidationViewed(project, issueNumber, this.filesystem)
    );
  }

  private transaction<T>(
    projectPath: string,
    operation: (project: string) => Promise<T>
  ): Promise<T> {
    if (this.stopping || this.pending.size >= 256)
      return Promise.reject(new UnavailableDomainError('Issue validation storage is unavailable.'));
    let project: string;
    try {
      project = this.canonicalProject(projectPath);
    } catch (error) {
      return Promise.reject(error);
    }
    const pending = (this.lanes.get(project) ?? Promise.resolve()).then(() => operation(project));
    const settled = pending.then(
      () => undefined,
      () => undefined
    );
    this.lanes.set(project, settled);
    this.pending.add(pending);
    void settled.then(() => {
      this.pending.delete(pending);
      if (this.lanes.get(project) === settled) this.lanes.delete(project);
    });
    return pending;
  }

  /** Registry producers drain in onModuleDestroy; this barrier precedes secure FS close. */
  beforeApplicationShutdown(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    const deadline = performance.now() + 5000;
    let timer: NodeJS.Timeout | undefined;
    this.shutdown = Promise.race([
      Promise.allSettled([...this.pending]).then((results) => {
        if (performance.now() >= deadline) throw new IssueValidationStorageCleanupError();
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new IssueValidationStorageCleanupError()), 5000);
      }),
    ]).finally(() => clearTimeout(timer));
    return this.shutdown;
  }
}

export class IssueValidationStorageCleanupError extends Error {
  readonly code = 'ISSUE_VALIDATION_STORAGE_CLEANUP_FAILED';
  constructor() {
    super('Issue validation storage cleanup could not be confirmed.');
  }
}
