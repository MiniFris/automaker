import type { HttpDomainTransport } from './transport';
import type { GitAPI } from '@/types/electron';

export function createGitClient(transport: Pick<HttpDomainTransport, 'post'>): GitAPI {
  return {
    getDiffs: (projectPath: string) => transport.post('/api/git/diffs', { projectPath }),
    getFileDiff: (projectPath: string, filePath: string) =>
      transport.post('/api/git/file-diff', { projectPath, filePath }),
    stageFiles: (projectPath: string, files: string[], operation: 'stage' | 'unstage') =>
      transport.post('/api/git/stage-files', { projectPath, files, operation }),
    getDetails: (projectPath: string, filePath?: string) =>
      transport.post('/api/git/details', { projectPath, filePath }),
    getEnhancedStatus: (projectPath: string) =>
      transport.post('/api/git/enhanced-status', { projectPath }),
  };
}
