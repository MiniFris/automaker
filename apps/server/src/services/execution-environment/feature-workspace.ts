import path from 'node:path';
import fs from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import type { ExecutionEnvironmentBinding, Feature } from '@automaker/types';
import { isDirectModel, isRemoteCliModel, isRemoteSdkModel } from '@automaker/types';
import { createLogger, type ContextFilesResult } from '@automaker/utils';
import type { SettingsService } from '../settings-service.js';
import { EnvironmentBindingStore } from './bindings.js';
import { ManagedSSH, SSHExecutionEnvironment } from './ssh.js';
import { sshSerialized } from './ssh-state.js';
import { nodeCommand } from './ssh-transport.js';
import { ExecutionEnvironmentError, type ExecutionEnvironment } from './runtime.js';
import { boundRuntime } from './bound-runtime.js';
import { verifyManagedFeatureWorkspace } from './managed-feature-workspace.js';
import { RuntimeMemoryStore } from './memory.js';

const logger = createLogger('FeatureWorkspace');

export const featureRunKey = (projectPath: string, featureId: string) =>
  `feature:${projectPath}:${featureId}`;
export interface FeatureWorkspaceRun {
  binding: ExecutionEnvironmentBinding;
  environment: ExecutionEnvironment;
}

/** One feature workspace for agents and app services; metadata stays on the controller. */
export class FeatureWorkspaceService {
  private readonly hostEnvironment: Readonly<NodeJS.ProcessEnv>;
  constructor(
    private readonly settings: SettingsService,
    private readonly manager = new ManagedSSH(settings),
    hostEnvironment: Readonly<NodeJS.ProcessEnv> = process.env
  ) {
    this.hostEnvironment = Object.freeze({ ...hostEnvironment });
  }

  async projectBranch(
    projectPath: string,
    signal: AbortSignal
  ): Promise<string | null | undefined> {
    const state = await new EnvironmentBindingStore(
      this.settings,
      undefined,
      undefined,
      this.hostEnvironment
    ).configuration(projectPath);
    if (state.resolved.type !== 'ssh') return undefined;
    const profile = state.resolved.profile;
    if (profile?.type !== 'ssh')
      throw new ExecutionEnvironmentError(
        'SSH_PROJECT_REQUIRED',
        'Saved SSH profile is unavailable.'
      );
    const trusted = await this.manager.state.trust(profile);
    const binding = trusted
      ? await this.manager.state.project(
          profile,
          trusted.fingerprint,
          await fs.realpath(projectPath)
        )
      : undefined;
    if (!binding?.ready)
      throw new ExecutionEnvironmentError(
        'SSH_PROJECT_REQUIRED',
        'Prepare the authoritative SSH checkout before selecting its branch or starting AutoMode.'
      );
    await this.manager.verify({ ...binding, profile }, signal);
    const result = await new SSHExecutionEnvironment(
      this.manager,
      { ...binding, profile },
      binding.remotePath
    ).exec('git symbolic-ref --quiet --short HEAD', signal);
    if (result.exitCode !== 0)
      throw new ExecutionEnvironmentError(
        'SSH_BRANCH_REQUIRED',
        'The remote checkout must be on a local branch. No controller branch lookup was performed.'
      );
    return result.output.trim() || null;
  }

  async prepare(
    projectPath: string,
    feature: Pick<Feature, 'id' | 'model' | 'branchName'>,
    signal: AbortSignal,
    create = true
  ): Promise<FeatureWorkspaceRun | undefined> {
    const store = new EnvironmentBindingStore(
      this.settings,
      undefined,
      undefined,
      this.hostEnvironment
    );
    const key = featureRunKey(projectPath, feature.id);
    const pinned = await store.peek(projectPath, key);
    const type = pinned?.type ?? (await store.configuration(projectPath)).resolved.type;
    if (type !== 'ssh') {
      if (
        ['docker', 'auto'].includes(type) ||
        pinned?.featureWorkspace ||
        pinned?.featurePreparation
      ) {
        if (!create && (!pinned || pinned.featurePreparation))
          throw new ExecutionEnvironmentError(
            'FEATURE_WORKSPACE_REQUIRED',
            'Start this feature before Verify/Commit/merge. No implicit workspace was created.'
          );
        const { binding } = await store.bind({
          projectPath,
          cwd: pinned?.cwd ?? projectPath,
          key,
          legacySettings: {},
          signal,
          feature: { targetBranch: feature.branchName },
        });
        return {
          binding,
          environment: await boundRuntime(binding, this.settings, this.hostEnvironment),
        };
      }
      return undefined;
    }
    if (
      !isDirectModel(feature.model) &&
      !isRemoteCliModel(feature.model) &&
      !isRemoteSdkModel(feature.model)
    )
      throw new ExecutionEnvironmentError(
        'SSH_PROVIDER_UNSUPPORTED',
        'This provider cannot execute in SSH yet. Select Local explicitly or use Direct, Cursor, Gemini or OpenCode; host execution was refused.'
      );
    if (!create && !(await store.peek(projectPath, key)))
      throw new ExecutionEnvironmentError(
        'SSH_FEATURE_REQUIRED',
        'Start this feature to prepare its remote workspace before verification or commit. No implicit workspace or Local fallback was used.'
      );
    const { binding } = await store.bind({
      projectPath,
      cwd: projectPath,
      key,
      legacySettings: {},
      signal,
      sshFeature: { targetBranch: feature.branchName },
    });
    if (!binding.ssh || !binding.runtimeCwd || !binding.sshWorkspace)
      throw new ExecutionEnvironmentError(
        'SSH_FEATURE_REQUIRED',
        'Pinned SSH feature workspace is unavailable.'
      );
    return {
      binding,
      environment: new SSHExecutionEnvironment(this.manager, binding.ssh, binding.runtimeCwd),
    };
  }

  async context(run: FeatureWorkspaceRun, signal: AbortSignal): Promise<ContextFilesResult> {
    const files: ContextFilesResult['files'] = [];
    let bytes = 0;
    const read = async (file: string) => {
      try {
        const result = await run.environment.readFile(file, 0, 32769, signal);
        bytes += result.size;
        if (result.size > 32768 || bytes > 65536)
          throw new ExecutionEnvironmentError(
            run.binding.type === 'ssh' ? 'SSH_CONTEXT_BUDGET' : 'FEATURE_CONTEXT_BUDGET',
            'Remote context exceeds 32 KiB/file or 64 KiB total. Reduce automatic context; the agent can read additional files explicitly.'
          );
        const content = new TextDecoder('utf8', { fatal: true }).decode(result.data);
        files.push({ name: path.posix.basename(file), path: file, content });
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? ''))
          throw error;
      }
    };
    for (const name of ['AGENTS.md', 'CLAUDE.md', 'CODE_QUALITY.md'])
      await read(path.posix.join(run.environment.cwd, name));
    // Shared context is read through the runtime from its authoritative project root.
    for (const directory of ['context']) {
      const root = path.posix.join(
        run.binding.ssh?.remotePath ?? run.binding.projectPath,
        '.automaker',
        directory
      );
      let listing;
      try {
        listing = await run.environment.listDirectory(root, 50, signal);
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? '')) continue;
        throw error;
      }
      if (listing.truncated)
        throw new ExecutionEnvironmentError(
          run.binding.type === 'ssh' ? 'SSH_CONTEXT_BUDGET' : 'FEATURE_CONTEXT_BUDGET',
          'Too many remote context files; reduce automatic context.'
        );
      for (const file of listing.entries.sort((a, b) => a.name.localeCompare(b.name)))
        if (file.type === 'file' && /\.(md|txt)$/i.test(file.name) && file.name !== '_index.md')
          await read(path.posix.join(root, file.name));
    }
    const memory = this.memory(run);
    const memoryFiles = await memory.load(signal, 65536 - bytes);
    // Only count loads after the complete source context passed its budgets.
    try {
      await memory.recordLoaded(memoryFiles, signal);
    } catch (error) {
      signal.throwIfAborted();
      logger.warn('Target memory load statistics were not saved (no replay/fallback):', error);
    }
    return {
      files,
      memoryFiles,
      formattedPrompt:
        files.length || memoryFiles.length
          ? '# Remote project context\n\n' +
            [...files, ...memoryFiles]
              .map((file) => `## ${file.path}\n\n${file.content}`)
              .join('\n\n')
          : '',
    };
  }

  memory(run: FeatureWorkspaceRun): RuntimeMemoryStore {
    return new RuntimeMemoryStore(run.environment, run.binding);
  }

  private async gitAction(
    run: FeatureWorkspaceRun,
    action: 'status' | 'commit' | 'merge',
    signal: AbortSignal,
    message = ''
  ) {
    const { binding, environment } = run;
    if (binding.type === 'ssh') {
      await this.manager.verify(binding.ssh!, signal);
      await this.manager.verifyWorkspace(
        binding.ssh!,
        environment.cwd,
        binding.sshWorkspace!,
        signal
      );
    } else {
      if (
        binding.type === 'local' &&
        !(
          await new EnvironmentBindingStore(
            this.settings,
            undefined,
            undefined,
            this.hostEnvironment
          ).consent(binding.projectPath)
        ).autoFallbackConfirmed
      )
        throw new ExecutionEnvironmentError(
          'LOCAL_CONSENT_REQUIRED',
          'Auto Local fallback consent was revoked.'
        );
      await verifyManagedFeatureWorkspace(
        environment,
        binding.projectPath,
        binding.featureWorkspace!,
        signal
      );
    }
    const request = {
      action,
      root: binding.ssh?.remotePath ?? binding.projectPath,
      ...(binding.sshWorkspace ?? binding.featureWorkspace)!,
      message,
    };
    const result = await environment.exec(
      nodeCommand(
        String.raw`
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const p=JSON.parse(process.argv[1]);
const git=(cwd,...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const hash=value=>/^[a-f0-9]{40,64}$/.test(value);
try {
 if(git(process.cwd(),'symbolic-ref','--quiet','--short','HEAD')!==p.branch)throw Error();
 if(p.action==='status') {
   process.stdout.write(JSON.stringify({head:git(process.cwd(),'rev-parse','HEAD'),status:git(process.cwd(),'status','--porcelain'),diff:git(process.cwd(),'diff','--stat','HEAD')}));
 } else if(p.action==='commit') {
   if(!git(process.cwd(),'status','--porcelain'))process.stdout.write(JSON.stringify({commit:null}));
   else {
     git(process.cwd(),'add','-A');
     git(process.cwd(),'-c','user.name=Automaker','-c','user.email=automaker@localhost','commit','-m',p.message);
     process.stdout.write(JSON.stringify({commit:git(process.cwd(),'rev-parse','HEAD')}));
   }
 } else {
   if(git(process.cwd(),'status','--porcelain'))throw Object.assign(Error(),{reason:'dirty-source'});
   if(git(p.root,'symbolic-ref','--quiet','--short','HEAD')!==p.baseBranch)throw Object.assign(Error(),{reason:'target-branch'});
   git(p.root,'diff','--quiet');git(p.root,'diff','--cached','--quiet');
   const source=git(process.cwd(),'rev-parse','HEAD');if(!hash(source))throw Error();
   try{git(p.root,'merge-base','--is-ancestor','HEAD',source);}catch{throw Object.assign(Error(),{reason:'diverged'});}
   git(p.root,'merge','--ff-only',source);
   process.stdout.write(JSON.stringify({mergedHead:git(p.root,'rev-parse','HEAD')}));
 }
}catch(error){process.stdout.write(JSON.stringify({error:error.reason||'git-failed'}));process.exitCode=1;}
`,
        [JSON.stringify(request)]
      ),
      signal,
      { timeoutMs: 120000, maxOutputBytes: 60000 }
    );
    if (result.truncated)
      throw new ExecutionEnvironmentError(
        binding.type === 'ssh' ? 'SSH_GIT_OUTPUT_LIMIT' : 'FEATURE_GIT_OUTPUT_LIMIT',
        'Remote Git output exceeded its budget. Inspect the remote result before continuing.'
      );
    const value = JSON.parse(result.output) as {
      commit?: string | null;
      mergedHead?: string;
      head?: string;
      status?: string;
      diff?: string;
      error?: string;
    };
    if (result.exitCode !== 0) {
      const reasons: Record<string, string> = {
        'dirty-source': 'Commit remote feature changes before merging. They were not discarded.',
        'target-branch':
          'The remote root is on a different branch. Check out the pinned target there before merging; no automatic branch switch occurred.',
        diverged:
          'The remote target has diverged. Reconcile the feature branch remotely first; no merge or reset was performed.',
        'git-failed':
          'Remote Git operation failed. Inspect its working tree/index; no local Git operation or retry was performed.',
      };
      throw new ExecutionEnvironmentError(
        binding.type === 'ssh' ? 'SSH_GIT_FAILED' : 'FEATURE_GIT_FAILED',
        reasons[value.error ?? ''] ?? reasons['git-failed']
      );
    }
    return value;
  }
  status(run: FeatureWorkspaceRun, signal: AbortSignal) {
    return this.gitAction(run, 'status', signal);
  }
  async commit(
    run: FeatureWorkspaceRun,
    feature: Pick<Feature, 'id' | 'description'>,
    signal: AbortSignal
  ) {
    const title = feature.description?.split('\n')[0].slice(0, 100) || `Feature ${feature.id}`;
    return (
      (
        await this.gitAction(
          run,
          'commit',
          signal,
          `feat: ${title}\n\nImplemented by Automaker (${run.binding.type})`
        )
      ).commit ?? null
    );
  }
  async merge(run: FeatureWorkspaceRun, signal: AbortSignal) {
    // Serialize competing feature integrations into the same authoritative checkout.
    return sshSerialized(
      (run.binding.ssh?.identity ?? run.binding.docker?.engineId ?? run.binding.serverIdentity) +
        '\0' +
        (run.binding.ssh?.remotePath ?? run.binding.projectPath),
      () => this.gitAction(run, 'merge', signal)
    );
  }
}
