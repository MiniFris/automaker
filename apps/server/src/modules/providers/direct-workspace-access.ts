import { Inject, Injectable } from '@nestjs/common';
import { SecurityService } from '../../core/security/security.service.js';
import type { WorkspaceAccessPolicy } from '../../providers/openai-compatible/workspace.js';

/** App-scoped authority for legacy Direct file tools; DATA_DIR is always protected. */
@Injectable()
export class DirectWorkspaceAccess implements WorkspaceAccessPolicy {
  readonly allowedRootDirectory?: string;
  readonly dataDirectory: string;
  constructor(@Inject(SecurityService) private readonly security: SecurityService) {
    this.allowedRootDirectory = security.allowedRootDirectory;
    this.dataDirectory = security.dataDirectory;
    Object.freeze(this);
  }
  validatePath(candidate: string): string {
    return this.security.validateLocalPath(candidate, 'Direct workspace access');
  }
}
