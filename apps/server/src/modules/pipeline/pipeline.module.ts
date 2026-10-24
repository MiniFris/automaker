import { Module } from '@nestjs/common';
import { PipelineApplicationService } from './pipeline-application.service.js';
import { PipelineController } from './pipeline.controller.js';
import { PipelineService } from '../../services/pipeline-service.js';

@Module({
  controllers: [PipelineController],
  providers: [
    { provide: PipelineService, useFactory: () => new PipelineService() },
    PipelineApplicationService,
  ],
  exports: [PipelineApplicationService, PipelineService],
})
export class PipelineModule {}
