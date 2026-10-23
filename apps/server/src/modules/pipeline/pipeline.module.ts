import { Module } from '@nestjs/common';
import { PipelineApplicationService } from './pipeline-application.service.js';
import { PipelineController } from './pipeline.controller.js';

@Module({
  controllers: [PipelineController],
  providers: [PipelineApplicationService],
  exports: [PipelineApplicationService],
})
export class PipelineModule {}
