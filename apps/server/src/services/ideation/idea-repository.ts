import type { Idea, IdeaStatus, CreateIdeaInput, UpdateIdeaInput } from '@automaker/types';
import {
  getIdeasDir,
  getIdeaDir,
  getIdeaPath,
  getIdeationSessionsDir,
  getIdeationDraftsDir,
} from '@automaker/platform';
import {
  atomicWriteJson,
  DEFAULT_BACKUP_COUNT,
  createLogger,
  type AtomicWriteFilesystem,
} from '@automaker/utils';
import type * as secureFs from '../../lib/secure-fs.js';

const logger = createLogger('IdeationService');
export type IdeaFilesystem = AtomicWriteFilesystem & Pick<typeof secureFs, 'readdir' | 'rm'>;

export async function ensureIdeationDirectories(
  filesystem: Pick<AtomicWriteFilesystem, 'mkdir'>,
  projectPath: string
): Promise<void> {
  await filesystem.mkdir(getIdeasDir(projectPath), { recursive: true });
  await filesystem.mkdir(getIdeationSessionsDir(projectPath), { recursive: true });
  await filesystem.mkdir(getIdeationDraftsDir(projectPath), { recursive: true });
}

/** Disk-only collaborator. Accepted-job admission and mutation serialization stay with the application owners. */
export class IdeationIdeaRepository {
  constructor(
    private readonly filesystem: IdeaFilesystem,
    private readonly validateDirectory: (cwd: string) => void,
    private readonly generateId: (prefix: string) => string
  ) {}
  async createIdea(projectPath: string, input: CreateIdeaInput): Promise<Idea> {
    this.validateDirectory(projectPath);
    await ensureIdeationDirectories(this.filesystem, projectPath);

    const ideaId = this.generateId('idea');
    const now = new Date().toISOString();

    const idea: Idea = {
      id: ideaId,
      title: input.title,
      description: input.description,
      category: input.category,
      status: input.status || 'raw',
      impact: input.impact || 'medium',
      effort: input.effort || 'medium',
      conversationId: input.conversationId,
      sourcePromptId: input.sourcePromptId,
      userStories: input.userStories,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };

    // Save to disk
    const ideaDir = getIdeaDir(projectPath, ideaId);
    await this.filesystem.mkdir(ideaDir, { recursive: true });
    await atomicWriteJson(getIdeaPath(projectPath, ideaId), idea, {
      backupCount: DEFAULT_BACKUP_COUNT,
      filesystem: this.filesystem,
    });

    return idea;
  }

  /**
   * Get all ideas for a project
   */
  async getIdeas(projectPath: string): Promise<Idea[]> {
    try {
      const ideasDir = getIdeasDir(projectPath);

      try {
        await this.filesystem.access(ideasDir);
      } catch {
        return [];
      }

      const entries = (await this.filesystem.readdir(ideasDir, {
        withFileTypes: true,
      })) as import('fs').Dirent[];
      const ideaDirs = entries.filter((entry) => entry.isDirectory());

      const ideas: Idea[] = [];
      for (const dir of ideaDirs) {
        try {
          const ideaPath = getIdeaPath(projectPath, dir.name);
          const content = (await this.filesystem.readFile(ideaPath, 'utf-8')) as string;
          ideas.push(JSON.parse(content));
        } catch (error) {
          logger.warn(`Failed to load idea ${dir.name}:`, error);
        }
      }

      // Sort by updatedAt descending
      return ideas.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    } catch (error) {
      logger.error('Failed to get ideas:', error);
      return [];
    }
  }

  /**
   * Get a single idea
   */
  async getIdea(projectPath: string, ideaId: string): Promise<Idea | null> {
    try {
      const ideaPath = getIdeaPath(projectPath, ideaId);
      const content = (await this.filesystem.readFile(ideaPath, 'utf-8')) as string;
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Update an idea
   */
  async updateIdea(
    projectPath: string,
    ideaId: string,
    updates: UpdateIdeaInput
  ): Promise<Idea | null> {
    const idea = await this.getIdea(projectPath, ideaId);
    if (!idea) return null;

    const updatedIdea: Idea = {
      ...idea,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await atomicWriteJson(getIdeaPath(projectPath, ideaId), updatedIdea, {
      backupCount: DEFAULT_BACKUP_COUNT,
      filesystem: this.filesystem,
    });

    return updatedIdea;
  }

  /**
   * Delete an idea
   */
  async deleteIdea(projectPath: string, ideaId: string): Promise<void> {
    const ideaDir = getIdeaDir(projectPath, ideaId);
    try {
      await this.filesystem.rm(ideaDir, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  /**
   * Archive an idea
   */
  async archiveIdea(projectPath: string, ideaId: string): Promise<Idea | null> {
    return this.updateIdea(projectPath, ideaId, {
      status: 'archived' as IdeaStatus,
    });
  }
}
