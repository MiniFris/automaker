import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { resolvePhaseModel } from '@automaker/model-resolver';
import { getModelProvider, modelTimeout, providerModelTimeouts } from '@automaker/types';
import { classifyError, createLogger } from '@automaker/utils';
import type { StreamingQueryOptions } from '../../providers/simple-query-service.js';
import type { SettingsService } from '../../services/settings-service.js';
import {
  getAutoLoadClaudeMdSetting,
  getPhaseModelWithOverrides,
  getPromptCustomization,
} from '../../lib/settings-helpers.js';
import { DomainError, UnavailableDomainError } from '../../core/errors/domain-errors.js';
import { ProviderCleanupError } from '../../providers/provider-execution-scope.js';
import {
  type ObserveOperation,
  unobservedOperation,
} from '../../core/observability/operation-observer.js';

const logger = createLogger('ProjectAnalysis');
export const PROJECT_ANALYSIS_MAX_JOBS = 8;
export const PROJECT_ANALYSIS_MAX_BYTES = 4 * 1024 * 1024;
const DRAIN_MS = 5000;

export class ProjectAnalysisCleanupError extends Error {
  readonly code = 'PROJECT_ANALYSIS_CLEANUP_FAILED';
  constructor() {
    super('Project analysis cleanup could not be confirmed.');
  }
}
export class ProjectAnalysisRuntimeError extends Error {
  readonly code = 'PROJECT_ANALYSIS_RUNTIME_UNSUPPORTED';
  constructor() {
    super(
      'Project analysis is unavailable for the selected managed target. No controller analysis was started.'
    );
  }
}
export interface ProjectAnalysisPorts {
  canonicalProject(projectPath: string): string;
  query(options: StreamingQueryOptions, runKey: string): Promise<string>;
  save(projectPath: string, content: string, signal: AbortSignal): Promise<void>;
  emit(payload: Record<string, unknown>): void;
  observeOperation?: ObserveOperation;
}
interface AnalysisJob {
  id: string;
  projectPath: string;
  controller: AbortController;
  startedAt: number;
  task: Promise<void>;
  timer?: NodeJS.Timeout;
  cleanupTimer?: NodeJS.Timeout;
  expired: boolean;
  unknown: boolean;
  settled: boolean;
  reported: boolean;
}

/** Owns actual analysis work, independently of project feature execution leases. */
export class ProjectAnalysisService {
  private readonly jobs = new Set<AnalysisJob>();
  private stopping = false;
  private uncertain = false;
  private shutdown?: Promise<void>;
  constructor(
    private readonly settings: SettingsService,
    private readonly ports: ProjectAnalysisPorts
  ) {}

  launch(projectPath: string): void {
    if (this.stopping || this.uncertain || this.jobs.size >= PROJECT_ANALYSIS_MAX_JOBS)
      throw new UnavailableDomainError('Project analysis is unavailable.');
    const job: AnalysisJob = {
      id: `analysis-${randomUUID()}`,
      projectPath: this.ports.canonicalProject(projectPath),
      controller: new AbortController(),
      startedAt: performance.now(),
      task: Promise.resolve(),
      expired: false,
      unknown: false,
      settled: false,
      reported: false,
    };
    this.jobs.add(job);
    this.deadline(job, modelTimeout(undefined, 'agentTimeoutMs'));
    job.task = Promise.resolve()
      .then(() =>
        (this.ports.observeOperation ?? unobservedOperation)(
          'feature_execution',
          async () => {
            try {
              await this.run(job);
            } catch (error) {
              if (job.unknown) throw new ProjectAnalysisCleanupError();
              throw error;
            }
          },
          { featureId: job.id },
          job.controller.signal
        )
      )
      .catch((error) => {
        if (error instanceof ProjectAnalysisCleanupError || error instanceof ProviderCleanupError) {
          job.unknown = true;
          this.uncertain = true;
        }
        this.report(job, error);
      })
      .finally(() => {
        job.settled = true;
        clearTimeout(job.timer);
        clearTimeout(job.cleanupTimer);
        if (!job.unknown) this.jobs.delete(job);
      });
  }

  private deadline(job: AnalysisJob, timeoutMs: number): void {
    clearTimeout(job.timer);
    job.timer = setTimeout(
      () => {
        job.expired = true;
        job.controller.abort(new DomainError('Project analysis timed out.', 'TIMEOUT', 500));
        job.cleanupTimer = setTimeout(() => {
          if (job.settled) return;
          job.unknown = true;
          this.uncertain = true;
          this.report(job, new ProjectAnalysisCleanupError());
        }, DRAIN_MS);
      },
      Math.max(1, timeoutMs - (performance.now() - job.startedAt))
    );
  }

  private async run(job: AnalysisJob): Promise<void> {
    const signal = job.controller.signal;
    signal.throwIfAborted();
    this.ports.emit({
      type: 'auto_mode_feature_start',
      featureId: job.id,
      projectPath: job.projectPath,
      branchName: null,
      feature: {
        id: job.id,
        title: 'Project Analysis',
        description: 'Analyzing project structure',
      },
    });
    const { phaseModel, provider, credentials } = await getPhaseModelWithOverrides(
      'projectAnalysisModel',
      this.settings,
      job.projectPath,
      '[ProjectAnalysis]'
    );
    signal.throwIfAborted();
    const { model, thinkingLevel, reasoningEffort } = resolvePhaseModel(phaseModel);
    const global = await this.settings.getGlobalSettings();
    signal.throwIfAborted();
    this.deadline(
      job,
      modelTimeout(
        { ...global.modelTimeouts, ...providerModelTimeouts(global, getModelProvider(model)) },
        'agentTimeoutMs'
      )
    );
    const [prompts, autoLoad] = await Promise.all([
      getPromptCustomization(this.settings, '[ProjectAnalysis]'),
      getAutoLoadClaudeMdSetting(job.projectPath, this.settings, '[ProjectAnalysis]'),
    ]);
    signal.throwIfAborted();
    let bytes = 0;
    const result = await this.ports.query(
      {
        prompt: prompts.taskExecution.projectAnalysisPrompt,
        model,
        providerId: phaseModel.providerId,
        cwd: job.projectPath,
        settingsService: this.settings,
        maxTurns: 5,
        allowedTools: ['Read', 'Glob', 'Grep'],
        readOnly: true,
        abortController: job.controller,
        thinkingLevel,
        reasoningEffort,
        credentials,
        claudeCompatibleProvider: provider,
        settingSources: autoLoad ? ['user', 'project'] : undefined,
        onText: (content) => {
          signal.throwIfAborted();
          bytes += Buffer.byteLength(content);
          if (bytes > PROJECT_ANALYSIS_MAX_BYTES)
            throw new DomainError('Project analysis output is too large.', 'VALIDATION_ERROR', 400);
          this.ports.emit({
            type: 'auto_mode_progress',
            featureId: job.id,
            content,
            projectPath: job.projectPath,
          });
        },
      },
      job.id
    );
    signal.throwIfAborted();
    if (!result.trim() || Buffer.byteLength(result) > PROJECT_ANALYSIS_MAX_BYTES)
      throw new DomainError(
        'Project analysis returned an empty or oversized document.',
        'VALIDATION_ERROR',
        400
      );
    await this.ports.save(job.projectPath, result, signal);
    signal.throwIfAborted();
    this.ports.emit({
      type: 'auto_mode_feature_complete',
      featureId: job.id,
      featureName: 'Project Analysis',
      branchName: null,
      passes: true,
      message: 'Project analysis completed',
      projectPath: job.projectPath,
    });
  }

  private report(job: AnalysisJob, error: unknown): void {
    if (job.reported) return;
    job.reported = true;
    const cancellation = job.controller.signal.aborted && !job.expired && !job.unknown;
    const errorType = job.unknown
      ? 'unknown'
      : job.expired
        ? 'timeout'
        : cancellation
          ? 'cancellation'
          : classifyError(error).type;
    const message = job.unknown
      ? 'Project analysis cleanup is unconfirmed.'
      : job.expired
        ? 'Project analysis timed out.'
        : cancellation
          ? 'Project analysis cancelled.'
          : error instanceof ProjectAnalysisRuntimeError
            ? error.message
            : 'Project analysis failed.';
    this.ports.emit({
      type: 'auto_mode_error',
      featureId: job.id,
      featureName: 'Project Analysis',
      branchName: null,
      error: message,
      errorType,
      projectPath: job.projectPath,
      ...(error instanceof ProjectAnalysisRuntimeError && { code: error.code }),
    });
    if (!cancellation) logger.error('Project analysis failed.', { errorType });
  }

  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    const jobs = [...this.jobs];
    for (const job of jobs) {
      clearTimeout(job.timer);
      clearTimeout(job.cleanupTimer);
      job.controller.abort();
    }
    let timer: NodeJS.Timeout | undefined;
    const deadline = performance.now() + DRAIN_MS;
    this.shutdown = Promise.race([
      Promise.allSettled(jobs.map((job) => job.task)).then((results) => {
        if (
          this.uncertain ||
          performance.now() >= deadline ||
          results.some((result) => result.status === 'rejected')
        )
          throw new ProjectAnalysisCleanupError();
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          this.uncertain = true;
          for (const job of jobs)
            if (!job.settled) {
              job.unknown = true;
              this.report(job, new ProjectAnalysisCleanupError());
            }
          reject(new ProjectAnalysisCleanupError());
        }, DRAIN_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    return this.shutdown;
  }
}
