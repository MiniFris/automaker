/** Portable application command, target and result values; no transport schema aliases. */
export interface GithubIssueCommentsInput {
  projectPath: string;
  issueNumber: number;
  cursor?: string;
}

export interface GithubReviewCommentsInput {
  projectPath: string;
  prNumber: number;
}

export interface GithubResolveThreadInput {
  projectPath: string;
  threadId: string;
  resolve: boolean;
}
