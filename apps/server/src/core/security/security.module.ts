import { Global, Module } from '@nestjs/common';
import { secureFs } from '@automaker/platform';
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
    {
      provide: SECURE_FILESYSTEM,
      inject: [SecurityService],
      useFactory: (security: SecurityService) => {
        const filesystem = secureFs.createSecureFs((candidate, options) =>
          security.validateLocalPath(candidate, 'filesystem access', options?.followFinalSymlink)
        );
        // Domain mutation owners drain in onModuleDestroy, before this barrier.
        return Object.assign(filesystem, { beforeApplicationShutdown: () => filesystem.close() });
      },
    },
  ],
  exports: [SecurityService, AllowedPathGuard, ProjectPathPipe, SECURE_FILESYSTEM],
})
export class SecurityModule {}
