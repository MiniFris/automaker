import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HOST_ENVIRONMENT } from '../../src/core/config/index.js';
import { captureNativeLocalEnvironment } from '../../src/services/execution-environment/local.js';
import { EnvironmentBindingStore } from '../../src/services/execution-environment/bindings.js';
import { ManagedDocker } from '../../src/services/execution-environment/docker.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { ExecutionRegistry } from '../../src/modules/execution/execution-registry.service.js';
import { ProjectGitService } from '../../src/services/execution-environment/project-git.js';

const applications: Awaited<ReturnType<typeof createNestApplication>>[] = [];
const roots: string[] = [];
afterEach(async () => {
  const results = await Promise.allSettled(
    applications.splice(0).map((owner) => owner.app.close())
  );
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
});
async function fixture(name: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `local-execution-host-${name}-`));
  roots.push(root);
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin);
  await fs.writeFile(
    path.join(bin, 'owned-local-tool'),
    `#!/bin/sh\nprintf '%s|%s|%s|%s|%s|%s|%s|%s\\n' '${name}' "$OWNED_HOST" "$HOME" "$AUTOMAKER_API_KEY" "$DATA_DIR" "$PORT" "$NODE_PATH" "$LOCAL_USER_TOKEN"\n`,
    { mode: 0o700 }
  );
  const environment = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    HOME: root,
    PATH: bin,
    OWNED_HOST: name,
    LOCAL_USER_TOKEN: `user-${name}`,
    AUTOMAKER_API_KEY: `backend-${name}`,
    DATA_DIR: path.join(root, 'data'),
    PORT: '0',
    NODE_PATH: 'backend-module-path',
    ALLOWED_ROOT_DIRECTORY: root,
    ENABLE_REQUEST_LOGGING: 'false',
  };
  const owner = await createNestApplication({
    workingDirectory: root,
    environment,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
  });
  applications.push(owner);
  await owner.start();
  return { owner, root, environment };
}

it.skipIf(process.platform !== 'linux')(
  'keeps registry and Git runtimes on their owning app snapshot without exposing backend variables',
  async () => {
    const first = await fixture('first'),
      second = await fixture('second');
    vi.stubEnv('PATH', '/no-ambient-tooling');
    vi.stubEnv('HOME', '/ambient-home');
    vi.stubEnv('OWNED_HOST', 'ambient');
    vi.stubEnv('LOCAL_USER_TOKEN', 'ambient-user-token');
    vi.stubEnv('AUTOMAKER_API_KEY', 'ambient-backend-secret');
    for (const fixture of [first, second]) {
      fixture.environment.PATH = '/mutated-input-path';
      fixture.environment.OWNED_HOST = 'mutated-input';
      const { owner, root } = fixture;
      const name = fixture === first ? 'first' : 'second';
      const signal = new AbortController().signal;
      const { runtime } = await owner.app.get(ExecutionRegistry).open({
        version: 1,
        id: `owned-${name}`,
        type: 'local',
        projectPath: root,
        cwd: root,
        createdAt: '2026-10-25T00:00:00.000Z',
        serverIdentity: name,
        selection: { mode: 'local' },
        source: 'project',
      });
      const gitRuntime = (await owner.app.get(ProjectGitService).resolveOrLocal(root)).runtime;
      for (const execution of [runtime, gitRuntime]) {
        const result = await execution.exec('owned-local-tool', signal);
        expect(result.exitCode).toBe(0);
        expect(result.output.trim()).toBe(`${name}|${name}|${root}|||||user-${name}`);
        const override = await execution.exec(
          'OWNED_HOST=command-override owned-local-tool',
          signal
        );
        expect(override.output.trim()).toBe(`${name}|command-override|${root}|||||user-${name}`);
      }
    }
  }
);

it.skipIf(process.platform !== 'linux')(
  'prepares and reopens two pinned Local fallback workspaces with their application environments during native verification',
  async () => {
    const first = await fixture('first'),
      second = await fixture('second');
    const exec = promisify(execFile);
    const entries = [];
    for (const f of [first, second]) {
      const bin = path.join(f.root, 'bin');
      const trace = path.join(f.root, 'child-environments.log');
      await fs.symlink(process.execPath, path.join(bin, 'node'));
      await fs.writeFile(
        path.join(bin, 'git'),
        `#!/bin/sh\nprintf 'git|%s|%s|%s\\n' "$OWNED_HOST" "$AUTOMAKER_API_KEY" "$HOME" >> '${trace}'\nexec /usr/bin/git "$@"\n`,
        { mode: 0o700 }
      );
      await fs.writeFile(
        path.join(bin, 'npm'),
        `#!/bin/sh\ncase "$*" in 'run lint'|'run typecheck'|'test'|'run build') ;; *) exit 92;; esac\nprintf 'npm|%s|%s|%s\\n' "$OWNED_HOST" "$AUTOMAKER_API_KEY" "$HOME" >> '${trace}'\n`,
        { mode: 0o700 }
      );
      await exec('/usr/bin/git', ['-C', f.root, 'init', '-qb', 'main']);
      await fs.writeFile(
        path.join(f.root, '.gitignore'),
        '.automaker/\n.worktrees/\ndata/\nbin/\nchild-environments.log\n'
      );
      await fs.writeFile(path.join(f.root, 'source.txt'), 'base');
      await exec('/usr/bin/git', ['-C', f.root, 'add', '.']);
      await exec('/usr/bin/git', [
        '-C',
        f.root,
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '-qm',
        'base',
      ]);
      const settings = f.owner.app.get(SettingsService);
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'auto' }, profiles: [] },
      });
      const hostEnvironment = captureNativeLocalEnvironment(
        f.owner.app.get<NodeJS.ProcessEnv>(HOST_ENVIRONMENT)
      );
      // Explicit offline Docker preflight failure authorizes only the confirmed Local fallback.
      const store = new EnvironmentBindingStore(
        settings,
        new ManagedDocker(settings, async () => ({
          code: 1,
          stdout: '',
          stderr: 'offline fixture unavailable',
        })),
        undefined,
        hostEnvironment
      );
      await store.confirm(f.root, true);
      const feature = await f.owner.app.get(FeatureLoader).create(f.root, {
        id: 'owned-feature',
        title: 'Offline pinned verification',
        description: 'Fixture',
        model: 'cursor-auto',
        branchName: 'main',
        status: 'backlog',
      });
      entries.push({ f, store, feature, trace });
    }
    vi.stubEnv('PATH', '/usr/bin:/bin');
    vi.stubEnv('OWNED_HOST', 'ambient-change');
    vi.stubEnv('HOME', '/ambient-home');
    vi.stubEnv('AUTOMAKER_API_KEY', 'ambient-backend-secret');
    for (const { f, store, feature, trace } of entries) {
      const key = `feature:${f.root}:${feature.id}`;
      const { binding } = await store.bind({
        projectPath: f.root,
        cwd: f.root,
        key,
        legacySettings: {},
        feature: { targetBranch: 'main' },
      });
      expect(binding).toMatchObject({
        type: 'local',
        fallbackReason: 'docker-preflight-unavailable',
        featureWorkspace: { baseBranch: 'main' },
      });
      expect(binding.runtimeCwd).not.toBe(f.root);
      // A pinned fallback survives the later default change; verification must reopen its same worktree.
      await f.owner.app.get(SettingsService).updateGlobalSettings({
        executionEnvironment: { default: { mode: 'local' }, profiles: [] },
      });
      const facade = f.owner.app.get(AutoModeServiceCompat).createFacade(f.root);
      expect(await facade.verifyFeature(feature.id)).toBe(true);
      const name = f === first ? 'first' : 'second';
      const lines = (await fs.readFile(trace, 'utf8')).trim().split('\n');
      expect(lines.filter((line) => line.startsWith('npm|'))).toEqual(
        Array(4).fill(`npm|${name}||${f.root}`)
      );
      expect(lines.some((line) => line.startsWith('git|'))).toBe(true);
      expect(
        lines.every(
          (line) => line === `npm|${name}||${f.root}` || line === `git|${name}||${f.root}`
        )
      ).toBe(true);
      expect((await store.peek(f.root, key))?.runtimeCwd).toBe(binding.runtimeCwd);
    }
  }
);
