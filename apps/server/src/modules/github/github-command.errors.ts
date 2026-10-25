export type GithubCommandFailureKind =
  | 'spawn'
  | 'exit'
  | 'limit'
  | 'deadline'
  | 'cancel'
  | 'cleanup';
export class GithubCommandError extends Error {
  constructor(
    readonly kind: GithubCommandFailureKind,
    readonly rateLimited = false,
    readonly absent = false
  ) {
    super('GitHub command could not be completed.');
  }
}
