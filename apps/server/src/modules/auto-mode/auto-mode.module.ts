import { ProjectAnalysisService } from './project-analysis.service.js';
import {
  ProjectAnalysisFilesAdapter,
  type ProjectAnalysisFilesystem,
} from './project-analysis-files.adapter.js';
import { ProjectAnalysisQueryAdapter } from './project-analysis-query.adapter.js';
import { SettingsService } from '../../services/settings-service.js';
import { ProviderRegistry } from '../providers/provider-registry.service.js';
import { DirectCheckpointRepository } from '../providers/direct-checkpoint.repository.js';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import type { EventEmitter } from '../../lib/events.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';
import { HOST_ENVIRONMENT } from '../../core/config/index.js';
import { ApplicationMetrics } from '../../core/observability/application-metrics.js';
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
  providers: [
    autoModeProvider,
    AutoModeApplicationService,
    ProjectRunContextRegistry,
    {
      provide: ProjectAnalysisService,
      inject: [
        SettingsService,
        ProviderRegistry,
        DirectCheckpointRepository,
        APPLICATION_EVENTS,
        SECURE_FILESYSTEM,
        SecurityService,
        HOST_ENVIRONMENT,
        ApplicationMetrics,
      ],
      useFactory: (
        settings: SettingsService,
        providers: ProviderRegistry,
        checkpoints: DirectCheckpointRepository,
        events: EventEmitter,
        filesystem: ProjectAnalysisFilesystem,
        security: SecurityService,
        environment: Readonly<NodeJS.ProcessEnv>,
        metrics: ApplicationMetrics
      ) => {
        const files = new ProjectAnalysisFilesAdapter(filesystem, (candidate) =>
          security.validateLocalPath(candidate, 'project analysis output')
        );
        const queries = new ProjectAnalysisQueryAdapter(
          settings,
          providers,
          environment,
          checkpoints
        );
        return new ProjectAnalysisService(settings, {
          canonicalProject: (project) => security.validateLocalPath(project, 'project analysis'),
          query: (options, key) => queries.query(options, key),
          save: (project, content, signal) => files.save(project, content, signal),
          emit: (payload) => events.emit('auto-mode:event', payload),
          observeOperation: (kind, task, identity, signal, classify) =>
            metrics.operation(kind, task, identity, signal, classify),
        });
      },
    },
  ],
  exports: [AutoModeServiceCompat],
})
export class AutoModeModule {}
