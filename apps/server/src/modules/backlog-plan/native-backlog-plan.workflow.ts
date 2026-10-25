import { DirectCheckpointRepository } from '../providers/direct-checkpoint.repository.js';
import type { AgentCheckpointRepository } from '../../providers/openai-compatible/checkpoint.js';
import { HOST_ENVIRONMENT } from '../../core/config/index.js';
import { Inject, Injectable } from '@nestjs/common';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import type { EventEmitter } from '../../lib/events.js';
import { SettingsService } from '../../services/settings-service.js';
import { ProviderRegistry } from '../providers/provider-registry.service.js';
import { PlanningWorkflowContext } from '../app-spec/planning-workflow.context.js';
import type { BacklogPlanWorkflow } from './backlog-plan.ports.js';
import type { BacklogGenerateRequest } from './backlog-plan.schemas.js';
import { generateBacklogPlan } from './generate-plan.workflow.js';

@Injectable()
export class NativeBacklogPlanWorkflow implements BacklogPlanWorkflow {
  constructor(
    @Inject(APPLICATION_EVENTS) private readonly events: EventEmitter,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ProviderRegistry) private readonly providers: ProviderRegistry,
    @Inject(PlanningWorkflowContext) private readonly context: PlanningWorkflowContext,
    @Inject(HOST_ENVIRONMENT) private readonly hostEnvironment: Readonly<NodeJS.ProcessEnv>,
    @Inject(DirectCheckpointRepository)
    private readonly checkpointRepository?: AgentCheckpointRepository
  ) {}
  generate(input: BacklogGenerateRequest, controller: AbortController) {
    const run = this.context.operation(input.projectPath, controller.signal);
    return generateBacklogPlan(
      run.projectPath,
      input.prompt,
      this.events,
      controller,
      this.settings,
      input.model,
      input.branchName,
      input.providerId,
      this.providers,
      run,
      this.hostEnvironment,
      this.checkpointRepository
    );
  }
}
