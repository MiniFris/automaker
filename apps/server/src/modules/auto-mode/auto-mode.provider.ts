import { DirectCheckpointRepository } from '../providers/direct-checkpoint.repository.js';
import { ApplicationMetrics } from '../../core/observability/application-metrics.js';
import type { FactoryProvider } from '@nestjs/common';
import { HOST_ENVIRONMENT } from '../../core/config/index.js';
import { captureNativeLocalEnvironment } from '../../services/execution-environment/local.js';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import type { EventEmitter } from '../../lib/events.js';
import { SettingsService } from '../../services/settings-service.js';
import { FeatureLoader } from '../../services/feature-loader.js';
import { NotificationService } from '../../services/notification-service.js';
import { AutoModeServiceCompat } from '../../services/auto-mode/index.js';
import { ProviderRegistry } from '../providers/provider-registry.service.js';
import { ToolPolicyService } from '../providers/tool-policy.service.js';
import { PipelineService } from '../../services/pipeline-service.js';
import { ProjectRunContextRegistry } from './project-run-context.registry.js';
import { SecurityService } from '../../core/security/security.service.js';
import { FeatureRunCoordinator } from '../orchestration/feature-run-coordinator.service.js';
import { SECURE_FILESYSTEM } from '../../core/security/index.js';
import type { ExecutionFilesystem } from '../../services/execution-filesystem.js';

export const autoModeProvider: FactoryProvider<AutoModeServiceCompat> = {
  provide: AutoModeServiceCompat,
  inject: [
    APPLICATION_EVENTS,
    SettingsService,
    FeatureLoader,
    NotificationService,
    ProviderRegistry,
    ToolPolicyService,
    PipelineService,
    SECURE_FILESYSTEM,
    ProjectRunContextRegistry,
    SecurityService,
    FeatureRunCoordinator,
    HOST_ENVIRONMENT,
    DirectCheckpointRepository,
    ApplicationMetrics,
  ],
  useFactory: (
    events: EventEmitter,
    settings: SettingsService,
    features: FeatureLoader,
    notifications: NotificationService,
    providers: ProviderRegistry,
    policy: ToolPolicyService,
    pipeline: PipelineService,
    filesystem: ExecutionFilesystem,
    contexts: ProjectRunContextRegistry,
    security: SecurityService,
    coordinator: FeatureRunCoordinator,
    environment: Readonly<NodeJS.ProcessEnv>,
    checkpointRepository: DirectCheckpointRepository,
    metrics: ApplicationMetrics
  ) =>
    new AutoModeServiceCompat(
      events,
      settings,
      features,
      null,
      notifications,
      providers,
      policy,
      pipeline,
      filesystem,
      {
        contexts,
        checkpointRepository,
        observeOperation: (kind, task, identity, signal, classify) =>
          metrics.operation(kind, task, identity, signal, classify),
        coordinator,
        hostEnvironment: captureNativeLocalEnvironment(environment),
        validateWorkingDirectory: (cwd) => {
          security.validateLocalPath(cwd, 'auto mode working directory');
        },
      }
    ),
};
