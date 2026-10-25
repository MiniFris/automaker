import { pipelineApplicationServiceProvider } from './application.providers.js';
import { Module } from '@nestjs/common';
import { PipelineApplicationService } from './pipeline-application.service.js';
import { PipelineController } from './pipeline.controller.js';
import { PipelineService } from '../../services/pipeline-service.js';
import path from 'node:path';
import type * as SecureFilesystem from '../../lib/secure-fs.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';
import {
  FilePipelineConfigurationRepository,
  PipelineConfigurationRepository,
} from '../../services/pipeline-config.repository.js';

@Module({
  controllers: [PipelineController],
  providers: [
    {
      provide: PipelineConfigurationRepository,
      inject: [SECURE_FILESYSTEM, SecurityService],
      useFactory: (filesystem: typeof SecureFilesystem, security: SecurityService) =>
        new FilePipelineConfigurationRepository(
          filesystem,
          (project) => filesystem.mkdir(path.join(project, '.automaker'), { recursive: true }),
          (project) => security.validateLocalPath(project, 'pipeline configuration'),
          { strictRead: true, maxAccepted: 256 }
        ),
    },
    {
      provide: PipelineService,
      inject: [PipelineConfigurationRepository],
      useFactory: (repository: PipelineConfigurationRepository) => new PipelineService(repository),
    },
    pipelineApplicationServiceProvider,
  ],
  exports: [PipelineApplicationService, PipelineService],
})
export class PipelineModule {}
