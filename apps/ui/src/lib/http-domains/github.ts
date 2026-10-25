import type { HttpDomainTransport } from './transport';
import type { GitHubAPI, IssueValidationInput, IssueValidationEvent } from '../electron';
import type { ModelId, ThinkingLevel, ReasoningEffort } from '@automaker/types';
import type { EventCallback } from '../http-api-client';

export function createGithubClient(
  transport: Pick<HttpDomainTransport, 'post' | 'subscribeToEvent'>
): GitHubAPI {
  return {
    checkRemote: (projectPath: string) =>
      transport.post('/api/github/check-remote', { projectPath }),
    listIssues: (projectPath: string) => transport.post('/api/github/issues', { projectPath }),
    listPRs: (projectPath: string) => transport.post('/api/github/prs', { projectPath }),
    validateIssue: (
      projectPath: string,
      issue: IssueValidationInput,
      model?: ModelId,
      thinkingLevel?: ThinkingLevel,
      reasoningEffort?: ReasoningEffort,
      providerId?: string
    ) =>
      transport.post('/api/github/validate-issue', {
        projectPath,
        ...issue,
        model,
        thinkingLevel,
        reasoningEffort,
        providerId,
      }),
    getValidationStatus: (projectPath: string, issueNumber?: number) =>
      transport.post('/api/github/validation-status', { projectPath, issueNumber }),
    stopValidation: (projectPath: string, issueNumber: number) =>
      transport.post('/api/github/validation-stop', { projectPath, issueNumber }),
    getValidations: (projectPath: string, issueNumber?: number) =>
      transport.post('/api/github/validations', { projectPath, issueNumber }),
    markValidationViewed: (projectPath: string, issueNumber: number) =>
      transport.post('/api/github/validation-mark-viewed', { projectPath, issueNumber }),
    onValidationEvent: (callback: (event: IssueValidationEvent) => void) =>
      transport.subscribeToEvent('issue-validation:event', callback as EventCallback),
    getIssueComments: (projectPath: string, issueNumber: number, cursor?: string) =>
      transport.post('/api/github/issue-comments', { projectPath, issueNumber, cursor }),
    getPRReviewComments: (projectPath: string, prNumber: number) =>
      transport.post('/api/github/pr-review-comments', { projectPath, prNumber }),
    resolveReviewThread: async (projectPath: string, threadId: string, resolve: boolean) => {
      const result = await transport.post<{
        success: boolean;
        isResolved?: boolean;
        error?: string;
      }>('/api/github/resolve-pr-comment', { projectPath, threadId, resolve });
      if (result.success && result.isResolved !== resolve)
        throw new Error('GitHub thread mutation was not confirmed. No automatic retry was made.');
      return result;
    },
  };
}
