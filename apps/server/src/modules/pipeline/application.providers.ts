import type { FactoryProvider } from '@nestjs/common';
import { PipelineApplicationService } from './pipeline-application.service.js';
import { PipelineService } from '../../services/pipeline-service.js';

export const pipelineApplicationServiceProvider: FactoryProvider<PipelineApplicationService> = {
  provide: PipelineApplicationService,
  inject: [PipelineService],
  useFactory: (pipeline: ConstructorParameters<typeof PipelineApplicationService>[0]) =>
    new PipelineApplicationService(pipeline),
};
