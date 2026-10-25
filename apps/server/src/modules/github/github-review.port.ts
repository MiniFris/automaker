import type { IssueCommentsResult } from '@automaker/types';
import type { GithubRemote } from './github-read.port.js';

export interface PRReviewComment {
  id: string;
  author: string;
  avatarUrl?: string;
  body: string;
  path?: string;
  line?: number;
  createdAt: string;
  updatedAt?: string;
  isReviewComment: boolean;
  isOutdated?: boolean;
  isResolved?: boolean;
  threadId?: string;
  diffHunk?: string;
  side?: string;
  commitId?: string;
  isBot?: boolean;
}
export abstract class GithubCommentsReadPort {
  abstract issueComments(
    projectPath: string,
    remote: GithubRemote,
    issueNumber: number,
    cursor: string | undefined,
    signal: AbortSignal
  ): Promise<IssueCommentsResult>;
  abstract reviewComments(
    projectPath: string,
    remote: GithubRemote,
    prNumber: number,
    signal: AbortSignal
  ): Promise<PRReviewComment[]>;
}
export abstract class GithubReviewMutationPort {
  abstract resolveThread(
    projectPath: string,
    remote: GithubRemote,
    threadId: string,
    resolve: boolean,
    signal: AbortSignal
  ): Promise<{ isResolved: boolean }>;
}
