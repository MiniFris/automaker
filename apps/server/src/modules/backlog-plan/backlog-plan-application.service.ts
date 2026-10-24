import { Inject, Injectable } from '@nestjs/common';
import { resolvePhaseModel } from '@automaker/model-resolver';
import type { Feature, PhaseModelEntry, PlanningMode } from '@automaker/types';
import { SettingsService } from '../../services/settings-service.js';
import { FEATURE_REPOSITORY, type FeatureRepository } from '../features/feature.repository.js';
import { FeatureTransitionService } from '../features/feature-transition.service.js';
import { ProjectFeatureSerializer } from '../features/project-feature-serializer.js';
import {
  BACKLOG_PLAN_STORE,
  BACKLOG_PLAN_WORKFLOW,
  type BacklogPlanStore,
  type BacklogPlanWorkflow,
} from './backlog-plan.ports.js';
import { BacklogPlanJobRegistry } from './backlog-plan-job.registry.js';
import type { BacklogApplyRequest, BacklogGenerateRequest } from './backlog-plan.schemas.js';

const normalizeModel = (
  entry: PhaseModelEntry | string | undefined | null
): PhaseModelEntry | undefined =>
  typeof entry === 'string' ? { model: entry } : entry || undefined;

@Injectable()
export class BacklogPlanApplicationService {
  constructor(
    @Inject(BACKLOG_PLAN_WORKFLOW) private readonly workflow: BacklogPlanWorkflow,
    @Inject(BACKLOG_PLAN_STORE) private readonly store: BacklogPlanStore,
    @Inject(BacklogPlanJobRegistry) private readonly jobs: BacklogPlanJobRegistry,
    @Inject(FEATURE_REPOSITORY) private readonly features: FeatureRepository,
    @Inject(ProjectFeatureSerializer) private readonly serializer: ProjectFeatureSerializer,
    @Inject(FeatureTransitionService) private readonly transitions: FeatureTransitionService,
    @Inject(SettingsService) private readonly settings: SettingsService
  ) {}

  generate(input: BacklogGenerateRequest) {
    const admitted = this.jobs.generate(input, (controller, owned) =>
      this.workflow.generate(owned, controller)
    );
    if (!admitted) {
      return { success: false as const, error: 'Backlog plan generation is already running' };
    }
    return { success: true as const };
  }

  stop() {
    this.jobs.stop();
    return { success: true as const };
  }

  async status(projectPath: string) {
    return {
      success: true as const,
      isRunning: this.jobs.isRunning,
      savedPlan: await this.store.load(projectPath),
    };
  }

  clear(projectPath: string) {
    return this.jobs.track((signal) =>
      this.serializer.run(projectPath, async () => {
        signal.throwIfAborted();
        await this.store.clear(projectPath);
        return { success: true as const };
      })
    );
  }

  apply(input: BacklogApplyRequest) {
    return this.jobs.track((signal) =>
      this.serializer.run(input.projectPath, async () => {
        signal.throwIfAborted();
        const [globalSettings, projectSettings, allFeatures] = await Promise.all([
          this.settings.getGlobalSettings(),
          this.settings.getProjectSettings(input.projectPath),
          this.features.list(input.projectPath),
        ]);
        const defaultPlanningMode: PlanningMode = globalSettings.defaultPlanningMode ?? 'skip';
        signal.throwIfAborted();
        const defaultRequirePlanApproval = globalSettings.defaultRequirePlanApproval ?? false;
        const defaults = resolvePhaseModel(
          normalizeModel(projectSettings.defaultFeatureModel ?? globalSettings.defaultFeatureModel)
        );
        const featureMap = new Map(allFeatures.map((feature) => [feature.id, feature]));
        const appliedChanges: string[] = [];

        for (const change of input.plan.changes.filter(({ type }) => type === 'delete')) {
          signal.throwIfAborted();
          if (!change.featureId) continue;
          for (const feature of allFeatures) {
            signal.throwIfAborted();
            if (!feature.dependencies?.includes(change.featureId)) continue;
            const dependencies = feature.dependencies.filter((id) => id !== change.featureId);
            await this.features.update(input.projectPath, feature.id, { dependencies });
            feature.dependencies = dependencies;
          }
          signal.throwIfAborted();
          if (await this.features.delete(input.projectPath, change.featureId)) {
            appliedChanges.push(`deleted:${change.featureId}`);
            featureMap.delete(change.featureId);
          }
        }

        for (const change of input.plan.changes.filter(({ type }) => type === 'add')) {
          signal.throwIfAborted();
          if (!change.feature) continue;
          this.transitions.assertAllowed(change.feature.status ?? 'backlog');
          const source = change.feature as Partial<Feature>;
          const planningMode = source.planningMode ?? defaultPlanningMode;
          const created = await this.features.create(input.projectPath, {
            ...source,
            status: source.status ?? 'backlog',
            model: source.model ?? defaults.model,
            thinkingLevel: source.thinkingLevel ?? defaults.thinkingLevel,
            reasoningEffort: source.reasoningEffort ?? defaults.reasoningEffort,
            providerId: source.providerId ?? defaults.providerId,
            planningMode,
            requirePlanApproval:
              planningMode === 'skip' || planningMode === 'lite'
                ? false
                : (source.requirePlanApproval ?? defaultRequirePlanApproval),
            branchName: input.branchName,
          });
          appliedChanges.push(`added:${created.id}`);
          featureMap.set(created.id, created);
        }

        for (const change of input.plan.changes.filter(({ type }) => type === 'update')) {
          signal.throwIfAborted();
          if (!change.featureId || !change.feature) continue;
          this.transitions.assertAllowed(change.feature.status);
          const updated = await this.features.update(
            input.projectPath,
            change.featureId,
            change.feature as Partial<Feature>
          );
          appliedChanges.push(`updated:${change.featureId}`);
          featureMap.set(change.featureId, updated);
        }

        for (const dependency of input.plan.dependencyUpdates) {
          signal.throwIfAborted();
          const feature = featureMap.get(dependency.featureId);
          if (!feature) continue;
          const current = feature.dependencies ?? [];
          const dependencies = current
            .filter((id) => !dependency.removedDependencies.includes(id))
            .concat(dependency.addedDependencies.filter((id) => !current.includes(id)));
          await this.features.update(input.projectPath, dependency.featureId, { dependencies });
        }

        signal.throwIfAborted();
        await this.store.clear(input.projectPath);
        return { success: true as const, appliedChanges };
      })
    );
  }
}
