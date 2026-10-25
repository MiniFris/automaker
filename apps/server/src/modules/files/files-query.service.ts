import type { BrowseProjectInput, ResolveDirectoryInput } from './application.inputs.js';

import {
  NotFoundDomainError,
  ValidationDomainError,
  mapInfrastructureError,
} from '../../core/errors/domain-errors.js';
import { type ProjectFilePort } from './project-file.port.js';
import { SecurityService } from '../../core/security/security.service.js';
import os from 'node:os';
import path from 'node:path';

import { RuntimePathsService } from '../../core/config/index.js';

const HIDDEN_DIRECTORIES = new Set([
  '.git',
  '.worktrees',
  'node_modules',
  '.automaker',
  '__pycache__',
  '.cache',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  'coverage',
  'dist',
  'build',
  'out',
  '.venv',
  'venv',
  'target',
  'vendor',
]);

export class FilesQueryService {
  constructor(
    private readonly files: ProjectFilePort,
    private readonly security: SecurityService,
    private readonly paths: RuntimePathsService
  ) {}

  async read(filePath: string): Promise<Record<string, unknown>> {
    try {
      return { success: true, content: await this.files.read(filePath) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new NotFoundDomainError('File not found.');
      }
      throw mapInfrastructureError(error);
    }
  }

  async list(dirPath: string): Promise<Record<string, unknown>> {
    try {
      return { success: true, entries: await this.files.list(dirPath) };
    } catch (error) {
      throw mapInfrastructureError(error);
    }
  }

  async stat(filePath: string): Promise<Record<string, unknown>> {
    try {
      return { success: true, stats: await this.files.stat(filePath) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new NotFoundDomainError('File or directory not found');
      }
      throw mapInfrastructureError(error);
    }
  }

  async exists(filePath: string): Promise<Record<string, unknown>> {
    return { success: true, exists: await this.files.exists(filePath) };
  }

  async validatePath(filePath: string): Promise<Record<string, unknown>> {
    const resolved = this.security.validateLocalPath(filePath, 'validate filesystem path');
    const stats = await this.files.stat(resolved).catch(() => undefined);
    if (!stats) throw new ValidationDomainError('Path does not exist');
    if (!stats.isDirectory) throw new ValidationDomainError('Path is not a directory');
    return { success: true, path: resolved, isAllowed: true };
  }

  async browse(dirPath?: string): Promise<Record<string, unknown>> {
    const target = this.security.validateLocalPath(
      dirPath ?? this.security.allowedRootDirectory ?? os.homedir(),
      'browse directories'
    );
    const parent = path.dirname(target);
    let parentPath: string | null = null;
    if (parent !== target) {
      try {
        parentPath = this.security.validateLocalPath(parent, 'browse parent');
      } catch {
        parentPath = null;
      }
    }
    try {
      if (!(await this.files.stat(target)).isDirectory) {
        throw new ValidationDomainError('Path is not a directory');
      }
      const directories = (await this.files.list(target))
        .filter((entry) => entry.isDirectory && !entry.name.startsWith('.'))
        .map((entry) => ({ name: entry.name, path: path.join(target, entry.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { success: true, currentPath: target, parentPath, directories, drives: [] };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'EACCES' || code === 'EPERM') {
        return {
          success: true,
          currentPath: target,
          parentPath,
          directories: [],
          drives: [],
          warning: 'Permission denied - unable to read this directory',
        };
      }
      throw error;
    }
  }

  async browseProject(input: BrowseProjectInput): Promise<Record<string, unknown>> {
    const project = this.security.validateLocalPath(input.projectPath, 'browse project files');
    const normalized = input.relativePath ? path.normalize(input.relativePath) : '';
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      throw new ValidationDomainError(
        'Invalid relative path - must be within the project directory'
      );
    }
    const target = this.security.validateLocalPath(
      path.join(project, normalized),
      'browse project directory'
    );
    const relative = normalized === '.' ? '' : normalized;
    const parentRelativePath = relative
      ? path.dirname(relative) === '.'
        ? ''
        : path.dirname(relative)
      : null;
    const entries = (await this.files.list(target))
      .filter((entry) => !(entry.isDirectory && HIDDEN_DIRECTORIES.has(entry.name)))
      .map((entry) => ({
        ...entry,
        relativePath: relative
          ? path.posix.join(relative.replace(/\\/g, '/'), entry.name)
          : entry.name,
      }))
      .sort((a, b) =>
        a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1
      );
    return { success: true, currentRelativePath: relative, parentRelativePath, entries };
  }

  async resolveDirectory(input: ResolveDirectoryInput): Promise<Record<string, unknown>> {
    const candidates = new Set<string>();
    if (path.isAbsolute(input.directoryName) || input.directoryName.includes(path.sep)) {
      candidates.add(path.resolve(input.directoryName));
    }
    const home = os.homedir();
    for (const root of [
      this.paths.workingDirectory,
      home,
      path.join(home, 'Documents'),
      path.join(home, 'Desktop'),
      path.join(home, 'Projects'),
      path.dirname(this.paths.workingDirectory),
    ]) {
      candidates.add(path.join(root, input.directoryName));
    }
    for (const candidate of candidates) {
      try {
        const allowed = this.security.validateLocalPath(candidate, 'resolve directory');
        if (!(await this.files.stat(allowed)).isDirectory) continue;
        if (input.sampleFiles?.length) {
          let matches = 0;
          for (const sample of input.sampleFiles.slice(0, 5)) {
            const relative = sample.startsWith(`${input.directoryName}/`)
              ? sample.slice(input.directoryName.length + 1)
              : sample.split('/').slice(1).join('/') || path.basename(sample);
            if (await this.files.exists(path.join(allowed, relative))) matches++;
          }
          if (!matches) continue;
        }
        return { success: true, path: allowed };
      } catch {
        // Try the next allowed common location.
      }
    }
    throw new NotFoundDomainError(
      `Directory "${input.directoryName}" not found in common locations.`
    );
  }
}
