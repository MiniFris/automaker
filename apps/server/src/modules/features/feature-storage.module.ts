import { Global, Module } from '@nestjs/common';
import { FeatureLoader, type FeatureFilesystem } from '../../services/feature-loader.js';
import { SECURE_FILESYSTEM } from '../../core/security/security.module.js';
import { SecurityService } from '../../core/security/security.service.js';

/** Shared filesystem boundary, without making feature application services global. */
@Global()
@Module({
  providers: [
    {
      provide: FeatureLoader,
      inject: [SECURE_FILESYSTEM, SecurityService],
      useFactory: (filesystem: FeatureFilesystem, security: SecurityService) =>
        new FeatureLoader({
          filesystem,
          canonicalProject: (project) => security.validateLocalPath(project, 'feature project'),
        }),
    },
  ],
  exports: [FeatureLoader],
})
export class FeatureStorageModule {}
