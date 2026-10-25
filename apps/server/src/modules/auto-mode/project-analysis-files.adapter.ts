import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type * as Filesystem from '../../lib/secure-fs.js';
import { ProjectAnalysisCleanupError } from './project-analysis.service.js';

export type ProjectAnalysisFilesystem = Pick<
  typeof Filesystem,
  'mkdir' | 'writeFile' | 'rename' | 'rm'
>;

/** The controller stores only the resulting report; tools use their issued execution target. */
export class ProjectAnalysisFilesAdapter {
  constructor(
    private readonly filesystem: ProjectAnalysisFilesystem,
    private readonly validate: (candidate: string) => string
  ) {}
  async save(projectPath: string, content: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const target = this.validate(path.join(projectPath, '.automaker', 'project-analysis.md'));
    const temporary = `${target}.write.${randomUUID()}`;
    await this.filesystem.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    signal.throwIfAborted();
    try {
      await this.filesystem.writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
      signal.throwIfAborted();
      await this.filesystem.rename(temporary, target);
    } catch (error) {
      try {
        await this.filesystem.rm(temporary, { force: true });
      } catch {
        throw new ProjectAnalysisCleanupError();
      }
      throw error;
    }
  }
}
