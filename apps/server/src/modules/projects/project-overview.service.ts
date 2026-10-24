import { Inject, Injectable } from '@nestjs/common';
import type {
  AggregateFeatureCounts,
  AggregateProjectCounts,
  Feature,
  FeatureStatusCounts,
  ProjectHealthStatus,
  ProjectStatus,
} from '@automaker/types';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import { FeatureLoader } from '../../services/feature-loader.js';
import type { AutoModeServiceCompat, RunningAgentInfo } from '../../services/auto-mode/index.js';
import { NotificationService } from '../../services/notification-service.js';
import { ProjectRegistry, type RegisteredProject } from './project-registry.service.js';

function featureCounts(features: Feature[]): FeatureStatusCounts {
  const counts = { pending: 0, running: 0, completed: 0, failed: 0, verified: 0 };
  for (const feature of features) {
    if (feature.status && ['pending', 'ready', 'waiting_approval'].includes(feature.status))
      counts.pending++;
    else if (
      feature.status &&
      ['running', 'generating_spec', 'in_progress'].includes(feature.status)
    )
      counts.running++;
    else if (feature.status === 'completed') counts.completed++;
    else if (feature.status === 'failed') counts.failed++;
    else if (feature.status === 'verified') counts.verified++;
    else counts.pending++;
  }
  return counts;
}

function health(counts: FeatureStatusCounts, autoRunning: boolean): ProjectHealthStatus {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (counts.failed) return 'error';
  if (counts.running || (autoRunning && counts.pending)) return 'active';
  if (counts.pending) return 'waiting';
  if (total) return 'completed';
  return 'idle';
}

function lastActivity(features: Feature[]): string | undefined {
  const timestamps = features.flatMap((feature) => [
    feature.startedAt,
    feature.planSpec?.generatedAt,
    feature.planSpec?.approvedAt,
  ]);
  const latest = Math.max(
    0,
    ...timestamps.map((value) => (value ? new Date(value).getTime() : 0)).filter(Number.isFinite)
  );
  return latest ? new Date(latest).toISOString() : undefined;
}

@Injectable()
export class ProjectOverviewService {
  constructor(
    @Inject(ProjectRegistry) private readonly registry: ProjectRegistry,
    @Inject(FeatureLoader) private readonly features: FeatureLoader,
    @Inject(LEGACY_SERVICES.autoMode) private readonly autoMode: AutoModeServiceCompat,
    @Inject(NotificationService) private readonly notifications: NotificationService
  ) {}

  async overview(): Promise<Record<string, unknown>> {
    const projects = await this.registry.list();
    const running = await this.autoMode.getRunningAgents();
    const statuses = await Promise.all(
      projects.map((project) => this.projectStatus(project, running))
    );
    const featureTotals: AggregateFeatureCounts = {
      total: 0,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      verified: 0,
    };
    const projectTotals: AggregateProjectCounts = {
      total: statuses.length,
      active: 0,
      idle: 0,
      waiting: 0,
      withErrors: 0,
      allCompleted: 0,
    };
    let totalUnreadNotifications = 0;
    let projectsWithAutoModeRunning = 0;
    for (const status of statuses) {
      featureTotals.total += status.totalFeatures;
      for (const key of ['pending', 'running', 'completed', 'failed', 'verified'] as const) {
        featureTotals[key] += status.featureCounts[key];
      }
      if (status.healthStatus === 'error') projectTotals.withErrors++;
      else if (status.healthStatus === 'completed') projectTotals.allCompleted++;
      else projectTotals[status.healthStatus]++;
      totalUnreadNotifications += status.unreadNotificationCount;
      if (status.isAutoModeRunning) projectsWithAutoModeRunning++;
    }
    const now = new Date().toISOString();
    return {
      success: true,
      projects: statuses,
      aggregate: {
        projectCounts: projectTotals,
        featureCounts: featureTotals,
        totalUnreadNotifications,
        projectsWithAutoModeRunning,
        computedAt: now,
      },
      recentActivity: [],
      generatedAt: now,
    };
  }

  private async projectStatus(
    project: RegisteredProject,
    running: RunningAgentInfo[]
  ): Promise<ProjectStatus> {
    try {
      const features = await this.features.getAll(project.path);
      const counts = featureCounts(features);
      counts.running = running.filter((agent) => agent.projectPath === project.path).length;
      const auto = await this.autoMode.getStatusForProject(project.path, null);
      let unreadNotificationCount = 0;
      try {
        unreadNotificationCount = (await this.notifications.getNotifications(project.path)).filter(
          (notification) => !notification.read
        ).length;
      } catch {
        // Missing notification storage is an empty collection.
      }
      return {
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        healthStatus: health(counts, auto.isAutoLoopRunning),
        featureCounts: counts,
        totalFeatures: features.length,
        lastActivityAt: lastActivity(features),
        isAutoModeRunning: auto.isAutoLoopRunning,
        activeBranch: auto.branchName ?? undefined,
        unreadNotificationCount,
      };
    } catch {
      return {
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        healthStatus: 'error',
        featureCounts: { pending: 0, running: 0, completed: 0, failed: 0, verified: 0 },
        totalFeatures: 0,
        isAutoModeRunning: false,
        unreadNotificationCount: 0,
      };
    }
  }
}
