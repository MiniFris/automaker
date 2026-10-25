import path from 'node:path';
import fs from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import { createLogger } from '@automaker/utils';
import { ForbiddenDomainError, UnavailableDomainError } from '../errors/index.js';
import { RuntimePathsService } from '../config/index.js';

const logger = createLogger('SecurityAudit');

@Injectable()
export class SecurityService {
  readonly allowedRootDirectory?: string;
  readonly dataDirectory: string;
  readonly workingDirectory: string;
  constructor(@Inject(RuntimePathsService) paths: RuntimePathsService) {
    this.workingDirectory = paths.workingDirectory;
    try {
      this.allowedRootDirectory = paths.allowedRootDirectory
        ? this.resolveSymlinks(paths.allowedRootDirectory)
        : undefined;
      this.dataDirectory = this.resolveSymlinks(paths.dataDirectory);
    } catch {
      throw new UnavailableDomainError('Local path policy could not be initialized.');
    }
  }
  validateLocalPath(
    candidate: string,
    operation = 'path access',
    followFinalSymlink = true
  ): string {
    try {
      const absolute = path.resolve(this.workingDirectory, candidate);
      const canonical = followFinalSymlink
        ? this.resolveSymlinks(absolute)
        : path.join(this.resolveSymlinks(path.dirname(absolute)), path.basename(absolute));
      if (!this.isAllowedCanonicalPath(canonical)) throw new ForbiddenDomainError();
      return canonical;
    } catch {
      logger.warn('rejected path operation', { operation, reason: 'PATH_NOT_ALLOWED' });
      throw new ForbiddenDomainError('Path not allowed by this application.');
    }
  }

  /** Only for callers which already canonicalized an absolute local path. */
  isAllowedCanonicalPath(candidate: string): boolean {
    return (
      !this.allowedRootDirectory ||
      this.isWithin(candidate, this.allowedRootDirectory) ||
      this.isWithin(candidate, this.dataDirectory)
    );
  }

  private resolveSymlinks(candidate: string): string {
    let current = path.resolve(this.workingDirectory, candidate);
    const missingSegments: string[] = [];
    for (;;) {
      try {
        return path.resolve(fs.realpathSync.native(current), ...missingSegments);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        // A dangling symlink is not an authorized missing directory to create.
        let existing: fs.Stats | undefined;
        try {
          existing = fs.lstatSync(current);
        } catch (probe) {
          if ((probe as NodeJS.ErrnoException).code !== 'ENOENT') throw probe;
        }
        if (existing) throw error;
        const parent = path.dirname(current);
        if (parent === current) throw error;
        missingSegments.unshift(path.basename(current));
        current = parent;
      }
    }
  }
  isWithin(
    candidate: string,
    parent: string,
    flavor: 'native' | 'posix' | 'win32' = 'native'
  ): boolean {
    const implementation = flavor === 'posix' ? path.posix : flavor === 'win32' ? path.win32 : path;
    const resolvedCandidate = implementation.resolve(candidate);
    const resolvedParent = implementation.resolve(parent);
    const relative = implementation.relative(resolvedParent, resolvedCandidate);
    return (
      relative !== '..' &&
      !relative.startsWith(`..${implementation.sep}`) &&
      !implementation.isAbsolute(relative)
    );
  }
}
