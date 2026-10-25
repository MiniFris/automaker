import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { vi } from 'vitest';
import { createNativeWorktreeHttp } from './native-worktree-http.js';

const execute = promisify(execFile);
/** Private actual Git/HTTP fixture; gh is a strict offline executable, never a vendor client. */
export async function createNativeLocalWorktree() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-local-worktree-'));
  const project = path.join(root, 'project'),
    bin = path.join(root, 'bin');
  await fs.mkdir(project);
  await fs.mkdir(bin);
  const gitBehavior = path.join(root, 'git-behavior.json');
  await fs.writeFile(gitBehavior, JSON.stringify({ fetchExit: 1 }));
  await fs.writeFile(
    path.join(bin, 'git'),
    `#!${process.execPath}
const fs=require('node:fs'),cp=require('node:child_process');const a=process.argv.slice(2);let i=0;while(a[i]?.startsWith('-')){i+=['-c','-C','--git-dir','--work-tree'].includes(a[i])?2:1;}const command=a[i],args=a.slice(i+1),file=${JSON.stringify(gitBehavior)},state=JSON.parse(fs.readFileSync(file,'utf8'));fs.appendFileSync(${JSON.stringify(path.join(root, 'git-calls.jsonl'))},JSON.stringify({command,args,argv:a,cwd:process.cwd()})+String.fromCharCode(10));
if(command==='worktree'&&args[0]==='list'&&state.porcelain!==undefined){process.stdout.write(state.porcelain);process.exit(0);}
if(command==='fetch')process.exit(state.fetchExit??1);
if(command==='remote'&&!args.length&&state.remoteCheckFailures){state.remoteCheckFailures--;fs.writeFileSync(file,JSON.stringify(state));process.exit(1);}
if(command==='remote'&&args[0]==='add'&&state.addFailure){process.stderr.write('private remote-add failure');process.exit(1);}
const r=cp.spawnSync('/usr/bin/git',a,{env:process.env,stdio:'inherit'});if(r.error)throw r.error;process.exit(r.status??1);
`,
    { mode: 0o700 }
  );
  const replies = path.join(root, 'gh-replies.json');
  await fs.writeFile(replies, JSON.stringify({ list: [] }));
  await fs.writeFile(
    path.join(bin, 'gh'),
    `#!${process.execPath}
const fs=require('node:fs'),a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(path.join(root, 'gh-calls.jsonl'))},JSON.stringify({args:a,cwd:process.cwd()})+String.fromCharCode(10));if(a[0]==='--version'){console.log('offline fixture');process.exit(0);}const r=JSON.parse(fs.readFileSync(${JSON.stringify(replies)},'utf8'));if(a[0]==='pr'&&a[1]==='list'){console.log(JSON.stringify(r.list));process.exit(0);}if(a[0]==='pr'&&a[1]==='view'&&r.views?.[a[2]]){console.log(JSON.stringify(r.views[a[2]]));process.exit(0);}process.exit(73);
`,
    { mode: 0o700 }
  );
  const environment = {
    HOME: root,
    USERPROFILE: root,
    GH_CONFIG_DIR: path.join(root, 'gh-config'),
    GH_TOKEN: '',
    GITHUB_TOKEN: '',
    PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
    GIT_CONFIG_GLOBAL: path.join(root, 'no-global-config'),
    GIT_CONFIG_SYSTEM: path.join(root, 'no-system-config'),
    GIT_TERMINAL_PROMPT: '0',
    ALLOWED_ROOT_DIRECTORY: root,
  };
  for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
  const git = async (args: string[], cwd = project) =>
    (await execute('git', args, { cwd, env: { ...process.env, ...environment } })).stdout.trim();
  let runtime: Awaited<ReturnType<typeof createNativeWorktreeHttp>>;
  try {
    const gh = await execute(path.join(bin, 'gh'), ['--version'], {
      env: { ...process.env, ...environment },
    });
    if (gh.stdout.trim() !== 'offline fixture')
      throw new Error('Offline gh fixture did not initialize.');
    await git(['init', '-b', 'main']);
    await git(['config', 'user.name', 'Fixture']);
    await git(['config', 'user.email', 'fixture@example.invalid']);
    await fs.writeFile(path.join(project, '.gitignore'), '.worktrees/\n.automaker/\n');
    await fs.writeFile(path.join(project, 'source.txt'), 'base\n');
    await git(['add', '.']);
    await git(['commit', '-m', 'Initial fixture']);
    runtime = await createNativeWorktreeHttp({ root, environment });
  } catch (error) {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
  const post = async (action: string, body: object) => {
    const response = await fetch(`${runtime.url}/api/worktree/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': runtime.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.json() };
  };
  return {
    root,
    project,
    runtime,
    git,
    post,
    inspect: async (cwd = project) =>
      (await post('environment', { projectPath: cwd })).body.executionEnvironment,
    addWorktree: async (branch: string, name = branch.replaceAll('/', '-')) => {
      const directory = path.join(project, '.worktrees', name);
      await git(['worktree', 'add', '-b', branch, directory, 'HEAD']);
      return directory;
    },
    github: async (value: unknown) => {
      await fs.writeFile(replies, JSON.stringify(value));
    },
    gitBehavior: async (value: unknown) => {
      await fs.writeFile(gitBehavior, JSON.stringify(value));
    },
    close: async () => {
      try {
        await runtime.close();
      } finally {
        vi.unstubAllEnvs();
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  };
}
