import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from '@automaker/utils';
import type { FeatureWorkspace } from '@automaker/types';
import { nodeCommand } from './ssh-transport.js';
import { ExecutionEnvironmentError, type ExecutionEnvironment } from './runtime.js';

/** All Git commands run in the target. The controller stores intent only. */
const gitPrelude = String.raw`
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const p=JSON.parse(process.argv[1]);
const git=(cwd,...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const root=fs.realpathSync(p.root);
if(root!==p.root||fs.realpathSync(path.resolve(root,git(root,'rev-parse','--git-common-dir')))!==path.join(root,'.git'))throw Error();
`;

export async function verifyManagedFeatureWorkspace(
  environment: ExecutionEnvironment,
  root: string,
  workspace: FeatureWorkspace,
  signal: AbortSignal
) {
  const result = await environment.exec(
    nodeCommand(
      gitPrelude +
        String.raw`
if(fs.realpathSync(process.cwd())!==p.cwd||
 git(p.cwd,'symbolic-ref','--quiet','--short','HEAD')!==p.workspace.branch||
 fs.realpathSync(path.resolve(p.cwd,git(p.cwd,'rev-parse','--git-common-dir')))!==path.join(root,'.git'))throw Error();
`,
      [JSON.stringify({ root, cwd: environment.cwd, workspace })]
    ),
    signal
  );
  if (result.exitCode !== 0 || result.truncated)
    throw new ExecutionEnvironmentError(
      'FEATURE_WORKSPACE_CHANGED',
      'Pinned feature branch/worktree no longer matches. No branch switch, repair or host fallback was performed.'
    );
}

export async function prepareManagedFeatureWorkspace(input: {
  environment: ExecutionEnvironment;
  directory: string;
  id: string;
  root: string;
  targetBranch?: string | null;
  signal: AbortSignal;
}) {
  const { environment, directory, id, root, targetBranch, signal } = input;
  if (environment.platform === 'win32')
    throw new ExecutionEnvironmentError(
      'FEATURE_PLATFORM_UNSUPPORTED',
      'Managed Auto Local fallback feature workspaces require a POSIX runtime. Use a Linux/WSL server or explicit Local workflow; no worktree command was dispatched.'
    );
  const cwd = path.posix.join(root, '.worktrees', `feature-${id.slice(0, 24)}`);
  const branch = `automaker/feature-${id.slice(0, 24)}`;
  const file = path.join(directory, 'feature-workspaces', `${id}.json`);
  let intent:
    | { workspace: FeatureWorkspace; cwd: string; root: string; state: 'creating' | 'ready' }
    | undefined;
  try {
    intent = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (intent) {
    if (
      intent.root !== root ||
      intent.cwd !== cwd ||
      intent.workspace.version !== 1 ||
      intent.workspace.branch !== branch ||
      (targetBranch && intent.workspace.baseBranch !== targetBranch)
    )
      throw new ExecutionEnvironmentError(
        'FEATURE_WORKSPACE_CHANGED',
        'Pinned feature intent changed. Start a new feature; no migration was performed.'
      );
    // Even a possibly successful create is never dispatched again. Verification is read-only.
    const checked = await environment.exec(
      nodeCommand(
        gitPrelude +
          String.raw`
if(fs.realpathSync(p.cwd)!==p.cwd||git(p.cwd,'symbolic-ref','--quiet','--short','HEAD')!==p.workspace.branch||
 fs.realpathSync(path.resolve(p.cwd,git(p.cwd,'rev-parse','--git-common-dir')))!==path.join(root,'.git'))throw Error();
if(p.creating){
 if(git(p.cwd,'rev-parse','HEAD')!==p.workspace.baseCommit)throw Error();
 git(p.cwd,'diff','--quiet');git(p.cwd,'diff','--cached','--quiet');
}
`,
        [
          JSON.stringify({
            root,
            cwd,
            workspace: intent.workspace,
            creating: intent.state === 'creating',
          }),
        ]
      ),
      signal
    );
    if (checked.exitCode !== 0 || checked.truncated)
      throw new ExecutionEnvironmentError(
        'FEATURE_WORKSPACE_RECOVERY_REQUIRED',
        'Feature worktree creation was interrupted or its identity changed. Inspect the target worktree and Git refs before retrying; creation was not replayed. Start a new feature if it cannot be reconciled.'
      );
    if (intent.state !== 'ready') {
      intent.state = 'ready';
      await atomicWriteJson(file, intent, { mode: 0o600 });
    }
    return { runtimeCwd: cwd, workspace: intent.workspace };
  }
  const source = await environment.exec(
    nodeCommand(
      gitPrelude +
        String.raw`
const branch=p.targetBranch||git(root,'symbolic-ref','--quiet','--short','HEAD');
git(root,'check-ref-format','refs/heads/'+branch);
const commit=git(root,'rev-parse','--verify','refs/heads/'+branch+'^{commit}');
if(!/^[a-f0-9]{40,64}$/.test(commit))throw Error();
if(fs.existsSync(p.cwd))throw Error();
try{git(root,'show-ref','--verify','--quiet','refs/heads/'+p.branch);throw Error('occupied');}catch(e){if(e.message==='occupied'||e.status!==1)throw e;}
const parent=path.dirname(p.cwd);if(fs.existsSync(parent)&&fs.realpathSync(parent)!==parent)throw Error();
process.stdout.write(JSON.stringify({branch,commit}));
`,
      [JSON.stringify({ root, cwd, branch, targetBranch })]
    ),
    signal
  );
  if (source.exitCode !== 0 || source.truncated)
    throw new ExecutionEnvironmentError(
      'FEATURE_BRANCH_REQUIRED',
      'Select an existing local target branch and an unused managed worktree path. No controller Git, checkout or branch fallback was performed.'
    );
  const base = JSON.parse(source.output) as { branch: string; commit: string };
  const workspace: FeatureWorkspace = {
    version: 1,
    branch,
    baseBranch: base.branch,
    baseCommit: base.commit,
  };
  intent = { root, cwd, workspace, state: 'creating' };
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await atomicWriteJson(file, intent, { mode: 0o600 });
  const created = await environment.exec(
    nodeCommand(
      gitPrelude +
        String.raw`
const parent=path.dirname(p.cwd);
fs.mkdirSync(parent,{recursive:true});if(fs.realpathSync(parent)!==parent)throw Error();
git(root,'worktree','add','-b',p.workspace.branch,'--',p.cwd,p.workspace.baseCommit);
`,
      [JSON.stringify({ root, cwd, workspace })]
    ),
    signal
  );
  if (created.exitCode !== 0 || created.truncated)
    throw new ExecutionEnvironmentError(
      'FEATURE_WORKTREE_FAILED',
      'Target worktree creation failed. Inspect its Git refs/index before retrying; no cleanup, retry or Local fallback was performed.'
    );
  intent.state = 'ready';
  await atomicWriteJson(file, intent, { mode: 0o600 });
  return { runtimeCwd: cwd, workspace };
}
