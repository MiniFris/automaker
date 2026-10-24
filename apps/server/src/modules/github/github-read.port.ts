export interface GithubRemote {
  hasGitHubRemote: boolean;
  remoteUrl: string | null;
  owner: string | null;
  repo: string | null;
}
export abstract class GithubReadPort {
  abstract remote(projectPath: string, signal: AbortSignal): Promise<GithubRemote>;
  abstract issues(
    projectPath: string,
    remote: GithubRemote,
    signal: AbortSignal
  ): Promise<{ openIssues: Record<string, unknown>[]; closedIssues: Record<string, unknown>[] }>;
  abstract prs(
    projectPath: string,
    remote: GithubRemote,
    signal: AbortSignal
  ): Promise<{ openPRs: Record<string, unknown>[]; mergedPRs: Record<string, unknown>[] }>;
}
