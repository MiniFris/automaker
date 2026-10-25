import path from 'node:path';
import os from 'node:os';

// Repository-local state must come from the requested cwd, not from the shell
// that launched this application (including when launched inside a Git hook).
// Keep host authentication/global configuration; this is not a Git sandbox.
const repositoryEnvironment = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
]);

export function githubCommandEnvironment(
  source: Readonly<NodeJS.ProcessEnv>,
  platform = process.platform
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      platform === 'win32' ? key.toUpperCase() : key,
      value,
    ])
  );
  const inheritedPath = environment.PATH;
  environment.PATH = [
    inheritedPath ?? (platform === 'win32' ? undefined : '/usr/bin:/bin'),
    ...(platform === 'win32'
      ? []
      : [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/home/linuxbrew/.linuxbrew/bin',
          path.join(environment.HOME || os.homedir(), '.local/bin'),
        ]),
  ]
    .filter(Boolean)
    .join(platform === 'win32' ? ';' : ':');
  if (platform === 'win32' && inheritedPath === undefined) delete environment.PATH;
  delete environment.GH_REPO;
  for (const key of Object.keys(environment)) {
    if (
      repositoryEnvironment.has(key) ||
      /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key) ||
      ['PORT', 'DATA_DIR', 'AUTOMAKER_API_KEY', 'NODE_PATH'].includes(key.toUpperCase())
    )
      delete environment[key];
  }
  return Object.assign(environment, {
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
  });
}
