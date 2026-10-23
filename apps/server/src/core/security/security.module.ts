import { Global, Module } from '@nestjs/common';
import * as secureFilesystem from '../../lib/secure-fs.js';
import { ProjectPathPipe } from './project-path.pipe.js';
import { AllowedPathGuard } from './allowed-path.guard.js';
import { SecurityService } from './security.service.js';

export const SECURE_FILESYSTEM = Symbol('SECURE_FILESYSTEM');

@Global()
@Module({
  providers: [
    SecurityService,
    AllowedPathGuard,
    ProjectPathPipe,
    { provide: SECURE_FILESYSTEM, useValue: secureFilesystem },
  ],
  exports: [SecurityService, AllowedPathGuard, ProjectPathPipe, SECURE_FILESYSTEM],
})
export class SecurityModule {}
