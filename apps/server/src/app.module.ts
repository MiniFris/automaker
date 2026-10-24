import { DynamicModule, Inject, MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';

import type { LegacyApplicationOptions } from './legacy-application.js';
import { AuthModule } from './core/auth/index.js';
import {
  RUNTIME_CONFIG,
  RuntimeConfigModule,
  type RuntimeConfig,
  assertNoLegacyServiceOverrides,
} from './core/config/index.js';
import { ErrorsModule } from './core/errors/index.js';
import { EventingModule } from './core/eventing/index.js';
import { HealthModule } from './core/health/health.module.js';
import { createPlatformMiddleware } from './core/http/platform-middleware.js';
import { LifecycleModule } from './core/lifecycle/lifecycle.module.js';
import { RequestContextMiddleware } from './core/observability/request-context.js';
import { ObservabilityModule } from './core/observability/observability.module.js';
import { SecurityModule } from './core/security/index.js';
import { ValidationModule } from './core/validation/validation.module.js';
import { LegacyModule } from './legacy/legacy.module.js';
import { ModelsModule } from './modules/models/models.module.js';
import { EventHistoryModule } from './modules/event-history/event-history.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { TemplatesModule } from './modules/templates/templates.module.js';
import { WorkspaceModule } from './modules/workspace/workspace.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { ContextModule } from './modules/context/context.module.js';
import { FeaturesModule } from './modules/features/features.module.js';
import { SessionsModule } from './modules/sessions/sessions.module.js';
import { AppSpecModule } from './modules/app-spec/app-spec.module.js';
import { BacklogPlanModule } from './modules/backlog-plan/backlog-plan.module.js';
import { IdeationModule } from './modules/ideation/ideation.module.js';
import { ExecutionModule } from './modules/execution/execution.module.js';
import { GitModule } from './modules/git/git.module.js';
import { WorktreeModule } from './modules/worktree/worktree.module.js';
import { ProvidersModule } from './modules/providers/providers.module.js';
import type { ProviderRegistration } from './modules/providers/provider-registry.service.js';
import { AgentsModule } from './modules/agents/agents.module.js';
import { PipelineModule } from './modules/pipeline/pipeline.module.js';
import { MCPModule } from './modules/mcp/mcp.module.js';
import { PromptEnhancementModule } from './modules/prompt-enhancement/prompt-enhancement.module.js';
import { GithubModule } from './modules/github/github.module.js';
import { AutoModeModule } from './modules/auto-mode/auto-mode.module.js';
import { TerminalModule } from './modules/terminal/terminal.module.js';
import { OrchestrationModule } from './modules/orchestration/orchestration.module.js';

@Module({})
export class AppModule {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  static register(
    config: RuntimeConfig,
    workingDirectory: string,
    serviceOptions: Pick<LegacyApplicationOptions, 'runStartupTasks' | 'httpServer'> & {
      hostEnvironment?: NodeJS.ProcessEnv;
      providerRegistrations?: readonly ProviderRegistration[];
    }
  ): DynamicModule {
    assertNoLegacyServiceOverrides(serviceOptions);
    const { hostEnvironment, providerRegistrations, ...legacyOptions } = serviceOptions;
    return {
      module: AppModule,
      imports: [
        RuntimeConfigModule.register(config, workingDirectory, hostEnvironment),
        LegacyModule.register(
          {
            ...legacyOptions,
            dataDir: config.storage.dataDirectory,
            workingDirectory,
          },
          config.storage.dataDirectory
        ),
        LifecycleModule,
        ErrorsModule,
        EventingModule,
        ObservabilityModule,
        AuthModule,
        SecurityModule,
        ValidationModule,
        SettingsModule,
        ProvidersModule.register(serviceOptions.runStartupTasks ?? true, providerRegistrations),
        AgentsModule,
        PipelineModule,
        MCPModule,
        PromptEnhancementModule,
        GithubModule,
        AutoModeModule,
        TerminalModule,
        OrchestrationModule,
        ProjectsModule,
        FilesModule,
        ContextModule,
        FeaturesModule,
        SessionsModule,
        AppSpecModule,
        BacklogPlanModule,
        IdeationModule,
        ExecutionModule,
        GitModule,
        WorktreeModule,
        HealthModule,
        ModelsModule,
        NotificationsModule,
        EventHistoryModule,
        TemplatesModule,
        WorkspaceModule,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // Nest adds the global /api prefix to middleware routes as well.
    consumer
      .apply(RequestContextMiddleware, ...createPlatformMiddleware(this.config))
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
