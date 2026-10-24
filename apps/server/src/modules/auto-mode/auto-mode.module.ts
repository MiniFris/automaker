import { Global, Module } from '@nestjs/common';
import { AutoModeController } from './auto-mode.controller.js';
import { AutoModeApplicationService } from './auto-mode-application.service.js';
import { ProjectRunContextRegistry } from './project-run-context.registry.js';
import { autoModeProvider } from './auto-mode.provider.js';
import { AutoModeServiceCompat } from '../../services/auto-mode/index.js';
import { PipelineModule } from '../pipeline/pipeline.module.js';

@Global()
@Module({
  imports: [PipelineModule],
  controllers: [AutoModeController],
  providers: [autoModeProvider, AutoModeApplicationService, ProjectRunContextRegistry],
  exports: [AutoModeServiceCompat],
})
export class AutoModeModule {}
