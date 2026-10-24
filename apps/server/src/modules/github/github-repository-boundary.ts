import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { SecurityService } from '../../core/security/security.service.js';
import { ForbiddenDomainError, UnavailableDomainError } from '../../core/errors/domain-errors.js';

export interface GithubRepositoryContext {
  cwd: string;
  gitDirectory: string;
  commonDirectory: string;
  workTree?: string;
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/** Per-application repository selection, not an OS/configuration-file sandbox. */
@Injectable()
export class GithubRepositoryBoundary {
  constructor(@Inject(SecurityService) private readonly security: SecurityService) {}

  /** undefined: unrestricted mode; null: no repository inside the allowed roots. */
  resolve(candidate: string): GithubRepositoryContext | null | undefined {
    if (!this.security.allowedRootDirectory) return undefined;
    try {
      const cwd = this.directory(path.resolve(this.security.workingDirectory, candidate));
      let current = cwd;
      for (let depth = 0; depth < 256; depth++) {
        const entry = path.join(current, '.git');
        if (this.exists(entry)) {
          const canonicalEntry = this.authorized(fs.realpathSync.native(entry));
          const stat = fs.statSync(canonicalEntry);
          const gitDirectory = stat.isDirectory()
            ? canonicalEntry
            : this.directory(path.resolve(current, this.pointer(canonicalEntry, 'gitdir: ')));
          return this.context(cwd, gitDirectory, current);
        }
        // A bare repository must not be skipped in favour of a containing repo.
        if (['HEAD', 'objects', 'refs'].every((name) => this.exists(path.join(current, name))))
          return this.context(cwd, current);
        const parent = path.dirname(current);
        if (parent === current || !this.allowed(parent)) return null;
        current = parent;
      }
      throw new UnavailableDomainError('GitHub repository discovery limit exceeded.');
    } catch (error) {
      if (error instanceof ForbiddenDomainError || error instanceof UnavailableDomainError)
        throw error;
      throw new UnavailableDomainError('GitHub repository context could not be verified.');
    }
  }

  private context(cwd: string, gitDirectory: string, workTree?: string): GithubRepositoryContext {
    const pointer = path.join(gitDirectory, 'commondir');
    const commonDirectory = this.exists(pointer)
      ? this.directory(path.resolve(gitDirectory, this.pointer(pointer)))
      : gitDirectory;
    return { cwd, gitDirectory, commonDirectory, workTree };
  }

  private allowed(candidate: string): boolean {
    return this.security.isAllowedCanonicalPath(candidate);
  }
  private authorized(candidate: string): string {
    if (!this.allowed(candidate))
      throw new ForbiddenDomainError(
        'GitHub repository context is outside the allowed directories.'
      );
    return candidate;
  }
  private directory(candidate: string): string {
    const canonical = this.authorized(fs.realpathSync.native(candidate));
    if (!fs.statSync(canonical).isDirectory())
      throw new UnavailableDomainError('GitHub repository directory is unavailable.');
    return canonical;
  }
  private exists(candidate: string): boolean {
    try {
      fs.lstatSync(candidate);
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }

  private pointer(candidate: string, prefix = ''): string {
    const canonical = this.authorized(fs.realpathSync.native(candidate));
    // Nonblocking open and fstat avoid following a special file into an unbounded read.
    const descriptor = fs.openSync(canonical, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size > 8192)
        throw new UnavailableDomainError('GitHub repository pointer is invalid.');
      const buffer = Buffer.alloc(8193);
      let bytes = 0;
      while (bytes < buffer.length) {
        const count = fs.readSync(descriptor, buffer, bytes, buffer.length - bytes, null);
        if (!count) break;
        bytes += count;
      }
      const value = buffer.subarray(0, bytes).toString('utf8').trimEnd();
      if (bytes > 8192 || !value.startsWith(prefix))
        throw new UnavailableDomainError('GitHub repository pointer is invalid.');
      const target = value.slice(prefix.length);
      if (!target || /[\0\r\n]/.test(target))
        throw new UnavailableDomainError('GitHub repository pointer is invalid.');
      return target;
    } finally {
      fs.closeSync(descriptor);
    }
  }
}
