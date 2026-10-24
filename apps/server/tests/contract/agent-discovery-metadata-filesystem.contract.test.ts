import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import { SettingsQueryService } from '../../src/modules/settings/settings-query.service.js';
import { AgentProfileSource } from '../../src/modules/settings/agent-profile.source.js';
import { FeatureCommandService } from '../../src/modules/features/feature-command.service.js';
import {
  FEATURE_REPOSITORY,
  type FeatureRepository,
} from '../../src/modules/features/feature.repository.js';
import type * as Filesystem from '../../src/lib/secure-fs.js';

let root: string;
const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-discovery-metadata-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  const results = await Promise.allSettled(apps.splice(0).map(({ app }) => app.close()));
  await fs.rm(root, { recursive: true, force: true });
  for (const result of results) if (result.status === 'rejected') throw result.reason;
});
async function owner(name: string, configuredHome = true) {
  const project = path.join(root, name, 'project'),
    home = path.join(root, name, 'home');
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  const runtime = await createNestApplication({
    workingDirectory: project,
    dataDir: path.join(project, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      ALLOWED_ROOT_DIRECTORY: project,
      ...(configuredHome ? { HOME: home } : {}),
    },
  });
  apps.push(runtime);
  return {
    ...runtime,
    project,
    home,
    filesystem: runtime.app.get<typeof Filesystem>(SECURE_FILESYSTEM),
    query: runtime.app.get(SettingsQueryService),
    profile: runtime.app.get(AgentProfileSource),
    commands: runtime.app.get(FeatureCommandService),
    features: runtime.app.get<FeatureRepository>(FEATURE_REPOSITORY),
  };
}
async function agent(base: string, name: string, text: string, subdirectory = false) {
  const file = path.join(base, '.claude/agents', subdirectory ? `${name}/AGENT.md` : `${name}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    `---\ndescription: ${text}\ntools: Read, Grep\nmodel: sonnet\n---\n${text} prompt`
  );
  return file;
}
async function metadata(project: string, branch: string) {
  const file = path.join(project, '.automaker/worktrees', branch, 'worktree.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ branch, createdAt: '2026-01-01T00:00:00.000Z', initScriptRan: true })
  );
  return file;
}

it('discovers only each explicit profile/project while preserving flat/subdirectory wire formats', async () => {
  const one = await owner('one'),
    two = await owner('two');
  await agent(one.home, 'user-one', 'User one');
  await fs.writeFile(path.join(one.home, '.claude/agents/ignored.md'), 'No agent frontmatter');
  await agent(two.home, 'user-two', 'User two', true);
  await agent(one.project, 'project-one', 'Project one', true);
  await agent(two.project, 'project-two', 'Project two');
  vi.stubEnv('HOME', two.home);
  const first = await one.query.discoverAgents({ projectPath: one.project });
  expect(first).toMatchObject({
    success: true,
    agents: [
      {
        name: 'user-one',
        source: 'user',
        definition: {
          description: 'User one',
          tools: ['Read', 'Grep'],
          model: 'sonnet',
          prompt: 'User one prompt',
        },
      },
      { name: 'project-one', source: 'project' },
    ],
  });
  expect((await two.query.discoverAgents({ projectPath: two.project })).agents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'user-two', source: 'user' }),
      expect.objectContaining({ name: 'project-two', source: 'project' }),
    ])
  );
  await expect(
    one.query.discoverAgents({ projectPath: two.project, sources: ['project'] })
  ).rejects.toMatchObject({ statusCode: 403 });
  await one.app.close();
  await expect(one.profile.exists(path.join(one.home, '.claude/agents'))).rejects.toMatchObject({
    statusCode: 503,
  });
  expect((await two.query.discoverAgents({ sources: ['user'] })).agents).toHaveLength(1);
});

it('does not fall back to operator HOME when the profile snapshot has no home', async () => {
  const runtime = await owner('no-home', false);
  await agent(runtime.home, 'operator', 'Do not discover');
  await agent(runtime.project, 'project', 'Explicit project');
  vi.stubEnv('HOME', runtime.home);
  expect((await runtime.query.discoverAgents({ projectPath: runtime.project })).agents).toEqual([
    expect.objectContaining({ name: 'project', source: 'project' }),
  ]);
});

it('keeps missing directories optional and propagates explicit profile/project IO failures', async () => {
  const runtime = await owner('io');
  expect((await runtime.query.discoverAgents({ projectPath: runtime.project })).agents).toEqual([]);
  const file = await agent(runtime.home, 'profile', 'Owned profile');
  const read = vi
    .spyOn(runtime.profile, 'readFile')
    .mockRejectedValue(Object.assign(new Error('Profile IO'), { code: 'EIO' }));
  await expect(runtime.query.discoverAgents({ sources: ['user'] })).rejects.toMatchObject({
    code: 'EIO',
  });
  expect(await fs.readFile(file, 'utf8')).toContain('Owned profile');
  read.mockRestore();
  await agent(runtime.project, 'project', 'Owned project');
  vi.spyOn(runtime.filesystem, 'readFile').mockRejectedValue(
    Object.assign(new Error('Project IO'), { code: 'EACCES' })
  );
  await expect(
    runtime.query.discoverAgents({ projectPath: runtime.project, sources: ['project'] })
  ).rejects.toMatchObject({ code: 'EACCES' });
});

it('rejects profile descendants that point into another profile without reading them', async () => {
  const one = await owner('profile-one'),
    two = await owner('profile-two');
  const foreign = await agent(two.home, 'private', 'Foreign profile');
  const directory = path.join(one.home, '.claude/agents');
  await fs.mkdir(directory, { recursive: true });
  await fs.symlink(foreign, path.join(directory, 'escape.md'));
  await expect(one.query.discoverAgents({ sources: ['user'] })).rejects.toMatchObject({
    statusCode: 403,
  });
  expect((await two.query.discoverAgents({ sources: ['user'] })).agents).toHaveLength(1);
});

it.each(['delete', 'move-to-branch'] as const)(
  'preserves feature and metadata when orphan %s cleanup fails',
  async (action) => {
    const runtime = await owner(action);
    await runtime.features.create(runtime.project, {
      id: 'orphan',
      description: 'Original',
      status: 'backlog',
      branchName: 'old',
    });
    const file = await metadata(runtime.project, 'old');
    const bytes = await fs.readFile(file, 'utf8');
    const featureFile = path.join(runtime.project, '.automaker/features/orphan/feature.json');
    const featureBytes = await fs.readFile(featureFile, 'utf8');
    vi.spyOn(runtime.filesystem, 'rm').mockRejectedValue(
      Object.assign(new Error('Metadata cleanup IO'), { code: 'EIO' })
    );
    expect(
      await runtime.commands.resolveOrphan({
        projectPath: runtime.project,
        featureId: 'orphan',
        action,
        targetBranch: null,
      })
    ).toMatchObject({ success: false, error: 'Metadata cleanup IO' });
    expect(await runtime.features.get(runtime.project, 'orphan')).toMatchObject({
      description: 'Original',
      branchName: 'old',
      status: 'backlog',
    });
    expect(await fs.readFile(file, 'utf8')).toBe(bytes);
    expect(await fs.readFile(featureFile, 'utf8')).toBe(featureBytes);
  }
);

it('uses canonical orphan-command lanes for aliases and scoped metadata deletion', async () => {
  const runtime = await owner('metadata'),
    other = await owner('other');
  for (const id of ['one', 'two'])
    await runtime.features.create(runtime.project, { id, description: id, branchName: 'old' });
  const file = await metadata(runtime.project, 'old'),
    foreign = await metadata(other.project, 'old');
  const alias = path.join(root, 'metadata-alias');
  await fs.symlink(runtime.project, alias, 'dir');
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
  const rm = runtime.filesystem.rm.bind(runtime.filesystem);
  const block = vi.spyOn(runtime.filesystem, 'rm').mockImplementation(async (...args) => {
    entered();
    await held;
    return rm(...args);
  });
  const first = runtime.commands.resolveOrphan({
    projectPath: runtime.project,
    featureId: 'one',
    action: 'delete',
  });
  await reached;
  const get = vi.spyOn(runtime.features, 'get');
  const second = runtime.commands.resolveOrphan({
    projectPath: alias,
    featureId: 'two',
    action: 'move-to-branch',
    targetBranch: null,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(get).not.toHaveBeenCalled();
  release();
  expect(await first).toMatchObject({ success: true });
  expect(await second).toMatchObject({ success: true, action: 'moved' });
  block.mockRestore();
  await expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(JSON.parse(await fs.readFile(foreign, 'utf8')).branch).toBe('old');
  await expect(
    Promise.resolve().then(() =>
      runtime.commands.resolveOrphan({
        projectPath: other.project,
        featureId: 'foreign',
        action: 'delete',
      })
    )
  ).rejects.toMatchObject({ statusCode: 403 });
});
