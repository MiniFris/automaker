import type { ProjectAnalysisResult } from '@automaker/types';
import { getIdeationAnalysisPath } from '@automaker/platform';
import {
  atomicWriteJson,
  DEFAULT_BACKUP_COUNT,
  createLogger,
  type AtomicWriteFilesystem,
} from '@automaker/utils';
import type { EventEmitter } from '../../lib/events.js';
import { ensureIdeationDirectories } from './idea-repository.js';
import type { IdeationProjectContextReader } from './project-context-reader.js';

const logger = createLogger('IdeationService');
/** Stateless analysis/cache collaborator; the caller owns cancellation, admission and drain. */
export class IdeationProjectAnalysis {
  constructor(
    private readonly filesystem: AtomicWriteFilesystem,
    private readonly validateDirectory: (cwd: string) => void,
    private readonly context: IdeationProjectContextReader,
    private readonly events: Pick<EventEmitter, 'emit'>
  ) {}
  async analyze(projectPath: string, controller: AbortController): Promise<ProjectAnalysisResult> {
    this.validateDirectory(projectPath);
    await ensureIdeationDirectories(this.filesystem, projectPath);

    this.emitAnalysisEvent('ideation:analysis-started', {
      projectPath,
      message: 'Starting project analysis...',
    });

    try {
      // Gather project structure
      const structure = await this.context.gatherProjectStructure(projectPath, controller.signal);
      controller.signal.throwIfAborted();

      this.emitAnalysisEvent('ideation:analysis-progress', {
        projectPath,
        progress: 30,
        message: 'Analyzing codebase structure...',
      });

      // Use AI to generate suggestions
      const suggestions = await this.context.generateAnalysisSuggestions(projectPath, structure);

      this.emitAnalysisEvent('ideation:analysis-progress', {
        projectPath,
        progress: 80,
        message: 'Generating improvement suggestions...',
      });

      const result: ProjectAnalysisResult = {
        projectPath,
        analyzedAt: new Date().toISOString(),
        totalFiles: structure.totalFiles,
        routes: structure.routes,
        components: structure.components,
        services: structure.services,
        framework: structure.framework,
        language: structure.language,
        dependencies: structure.dependencies,
        suggestions,
        summary: this.context.generateAnalysisSummary(structure, suggestions),
      };

      controller.signal.throwIfAborted();
      // Cache the result
      await atomicWriteJson(getIdeationAnalysisPath(projectPath), result, {
        backupCount: DEFAULT_BACKUP_COUNT,
        filesystem: this.filesystem,
      });

      this.emitAnalysisEvent('ideation:analysis-complete', {
        projectPath,
        result,
      });

      return result;
    } catch (error) {
      logger.error('Project analysis failed:', error);
      this.emitAnalysisEvent('ideation:analysis-error', {
        projectPath,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Emit analysis event wrapped in ideation:analysis format
   */
  private emitAnalysisEvent(eventType: string, data: Record<string, unknown>): void {
    this.events.emit('ideation:analysis', {
      type: eventType,
      ...data,
    });
  }

  async getCached(projectPath: string): Promise<ProjectAnalysisResult | null> {
    try {
      const content = (await this.filesystem.readFile(
        getIdeationAnalysisPath(projectPath),
        'utf-8'
      )) as string;
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}
