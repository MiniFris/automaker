import path from 'node:path';
import fs from 'node:fs';
import { Injectable } from '@nestjs/common';
import { createLogger } from '@automaker/utils';
import { validatePath, initAllowedPaths } from '@automaker/platform';
import { redactSecrets } from '../observability/request-context.js';
import { ForbiddenDomainError } from '../errors/index.js';

const logger = createLogger('SecurityAudit');

@Injectable()
export class SecurityService {
  constructor() {
    initAllowedPaths();
  }
  validateLocalPath(candidate: string, operation = 'path access'): string {
    try {
      return validatePath(this.resolveSymlinks(candidate));
    } catch (error) {
      logger.warn(
        'rejected path operation',
        redactSecrets({
          operation,
          candidate,
          reason: error instanceof Error ? error.message : error,
        })
      );
      throw new ForbiddenDomainError(error instanceof Error ? error.message : 'Path not allowed.');
    }
  }
  private resolveSymlinks(candidate: string): string {
    let current = path.resolve(candidate);
    const missingSegments: string[] = [];
    while (!fs.existsSync(current)) {
      const parent = path.dirname(current);
      if (parent === current) break;
      missingSegments.unshift(path.basename(current));
      current = parent;
    }
    const canonicalParent = fs.existsSync(current) ? fs.realpathSync.native(current) : current;
    return path.resolve(canonicalParent, ...missingSegments);
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
    return !relative.startsWith('..') && !implementation.isAbsolute(relative);
  }
}
