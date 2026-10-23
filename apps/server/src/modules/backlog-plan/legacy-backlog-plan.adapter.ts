import { Inject, Injectable } from '@nestjs/common';
import { LEGACY_EVENT_EMITTER } from '../../legacy/legacy.tokens.js';
import type { EventEmitter } from '../../lib/events.js';
import { clearBacklogPlan, loadBacklogPlan } from '../../routes/backlog-plan/common.js';
import { generateBacklogPlan } from '../../routes/backlog-plan/generate-plan.js';
import { SettingsService } from '../../services/settings-service.js';
import type { BacklogPlanStore, BacklogPlanWorkflow } from './backlog-plan.ports.js';
import type { BacklogGenerateRequest } from './backlog-plan.schemas.js';
import { ProviderRegistry } from '../providers/provider-registry.service.js';

@Injectable()
export class LegacyBacklogPlanAdapter implements BacklogPlanWorkflow, BacklogPlanStore {
  constructor(
    @Inject(LEGACY_EVENT_EMITTER) private readonly events: EventEmitter,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ProviderRegistry) private readonly providers: ProviderRegistry
  ) {}

  generate(input: BacklogGenerateRequest, abortController: AbortController) {
    return generateBacklogPlan(
      input.projectPath,
      input.prompt,
      this.events,
      abortController,
      this.settings,
      input.model,
      input.branchName,
      input.providerId,
      this.providers
    );
  }

  load(projectPath: string) {
    return loadBacklogPlan(projectPath);
  }

  clear(projectPath: string) {
    return clearBacklogPlan(projectPath);
  }
}
