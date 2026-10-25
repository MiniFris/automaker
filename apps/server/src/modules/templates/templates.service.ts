import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { createLogger } from '@automaker/utils';
import type * as SecureFilesystem from '../../lib/secure-fs.js';
import {
  DomainError,
  ForbiddenDomainError,
  ValidationDomainError,
  ConflictDomainError,
  UnavailableDomainError,
  CancellationDomainError,
} from '../../core/errors/index.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';
import { TEMPLATE_COMMAND_RUNNER, type TemplateCommandRunner } from './template-command.runner.js';
import type { CloneTemplateRequest } from './templates.schemas.js';
import { OwnedLocalChildCleanupError } from '../../services/owned-local-child.js';

const logger = createLogger('Templates');
interface CloneWorkflow {
  controller: AbortController;
  completion: Promise<Record<string, unknown>>;
  uncertain: boolean;
}
export class TemplateWorkflowCleanupError extends UnavailableDomainError {
  readonly code = 'TEMPLATE_WORKFLOW_CLEANUP_FAILED';
  constructor() {
    super('Template workflow cleanup could not be confirmed. Target identity was retained.');
  }
}

@Injectable()
export class TemplatesService {
  private readonly workflows = new Map<string, CloneWorkflow>();
  private stopping = false;
  private shutdown?: Promise<void>;
  constructor(
    @Inject(SECURE_FILESYSTEM) private readonly filesystem: typeof SecureFilesystem,
    @Inject(SecurityService) private readonly security: SecurityService,
    @Inject(TEMPLATE_COMMAND_RUNNER) private readonly commands: TemplateCommandRunner
  ) {}

  clone(input: CloneTemplateRequest): Promise<Record<string, unknown>> {
    try {
      return this.accept(input);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private accept(input: CloneTemplateRequest): Promise<Record<string, unknown>> {
    if (this.stopping || this.workflows.size >= 16)
      throw new UnavailableDomainError('Template workflows are unavailable.');
    const sanitizedName = input.projectName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const parentDir = this.validatePath(input.parentDir, 'clone template parent');
    const projectPath = this.validatePath(
      path.join(parentDir, sanitizedName),
      'clone template destination'
    );
    const relativePath = path.relative(parentDir, projectPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath))
      throw new ValidationDomainError('Invalid project name; potential path traversal attempt.');

    if (this.workflows.has(projectPath))
      throw new ConflictDomainError('A template workflow already owns this target.');
    const workflow: CloneWorkflow = {
      controller: new AbortController(),
      completion: Promise.resolve({}),
      uncertain: false,
    };
    this.workflows.set(projectPath, workflow);
    workflow.completion = Promise.resolve().then(() =>
      this.execute(input, sanitizedName, parentDir, projectPath, workflow)
    );
    void workflow.completion.then(
      () => {
        this.workflows.delete(projectPath);
      },
      () => {
        if (!workflow.uncertain) this.workflows.delete(projectPath);
      }
    );
    return workflow.completion;
  }

  private async execute(
    input: CloneTemplateRequest,
    sanitizedName: string,
    parentDir: string,
    projectPath: string,
    workflow: CloneWorkflow
  ): Promise<Record<string, unknown>> {
    const check = () => {
      if (this.stopping || workflow.controller.signal.aborted)
        throw new CancellationDomainError('Template workflow cancelled.');
    };
    let created = false;
    let identity: { dev: number | bigint; ino: number | bigint } | undefined;
    const checkOwned = async () => {
      const current = await this.filesystem.lstat(projectPath);
      if (
        !identity ||
        !current.isDirectory() ||
        current.dev !== identity.dev ||
        current.ino !== identity.ino
      )
        throw new TemplateWorkflowCleanupError();
      check();
    };
    try {
      check();
      await this.filesystem.mkdir(parentDir, { recursive: true });
      check();
      if (this.validatePath(projectPath, 'create template destination') !== projectPath)
        throw new ConflictDomainError('Template destination identity changed.');
      try {
        await this.filesystem.mkdir(projectPath, { recursive: false });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new ValidationDomainError(
            `Directory "${sanitizedName}" already exists in ${input.parentDir}`
          );
        throw error;
      }
      created = true;
      const initial = await this.filesystem.lstat(projectPath);
      if (!initial.isDirectory()) throw new TemplateWorkflowCleanupError();
      identity = { dev: initial.dev, ino: initial.ino };
      check();
      const clone = await this.commands.run(
        'git',
        ['clone', input.repoUrl, projectPath],
        parentDir,
        workflow.controller.signal
      );
      if (clone.exitCode !== 0)
        throw new DomainError('Failed to clone repository', 'UNKNOWN_OUTCOME', 500);

      check();
      await checkOwned();
      check();
      await this.filesystem.rm(path.join(projectPath, '.git'), { recursive: true, force: true });
      check();
      await checkOwned();
      check();
      const initialize = await this.commands.run(
        'git',
        ['init'],
        projectPath,
        workflow.controller.signal
      );
      if (initialize.exitCode !== 0) logger.warn('Could not initialize cloned template repository');

      check();
      await checkOwned();
      check();
      return { success: true, projectPath, projectName: sanitizedName };
    } catch (error) {
      if (
        error instanceof OwnedLocalChildCleanupError ||
        error instanceof TemplateWorkflowCleanupError
      ) {
        workflow.uncertain = true;
        throw error;
      }
      if (created) {
        try {
          const current = await this.filesystem.lstat(projectPath);
          if (
            !identity ||
            !current.isDirectory() ||
            current.dev !== identity.dev ||
            current.ino !== identity.ino
          )
            throw new TemplateWorkflowCleanupError();
          await this.filesystem.rm(projectPath, { recursive: true, force: true });
        } catch (cleanupError) {
          if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
            workflow.uncertain = true;
            throw new TemplateWorkflowCleanupError();
          }
        }
      }
      throw error;
    }
  }

  private validatePath(candidate: string, operation: string): string {
    try {
      return this.security.validateLocalPath(candidate, operation);
    } catch {
      throw new ForbiddenDomainError(
        `Project path not allowed: ${candidate}. Must be within ALLOWED_ROOT_DIRECTORY.`
      );
    }
  }

  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    const accepted = [...this.workflows.values()];
    for (const workflow of accepted) workflow.controller.abort();
    const deadline = performance.now() + 10000;
    let timer: NodeJS.Timeout | undefined;
    this.shutdown = Promise.race([
      Promise.allSettled(accepted.map((workflow) => workflow.completion)).then(() => {
        if (accepted.some((workflow) => workflow.uncertain) || performance.now() >= deadline)
          throw new TemplateWorkflowCleanupError();
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TemplateWorkflowCleanupError()), 10000);
      }),
    ]).finally(() => clearTimeout(timer));
    return this.shutdown;
  }
}
