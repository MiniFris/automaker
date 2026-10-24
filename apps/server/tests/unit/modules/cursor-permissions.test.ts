import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RuntimePathsService } from '../../../src/core/config/index.js';
import { CursorPermissionsRepository } from '../../../src/modules/providers/cursor-permissions.repository.js';
import { CursorPermissionsService } from '../../../src/modules/providers/cursor-permissions.service.js';
import { ProviderConnectionRepository } from '../../../src/modules/providers/provider-connection.repository.js';
import { CURSOR_PERMISSION_PROFILES } from '@automaker/types';

let directory: string;
let project: string;
let repository: CursorPermissionsRepository;
let service: CursorPermissionsService;
const permissions = { allow: ['Read(**)'], deny: ['Shell(rm)'] };
function create(name = 'profile') {
  const paths = {
    allowedRootDirectory: directory,
    resolveFromWorkingDirectory: (...segments: string[]) => path.resolve(directory, ...segments),
  } as RuntimePathsService;
  const environment = { CURSOR_CONFIG_DIR: path.join(directory, name) };
  const repo = new CursorPermissionsRepository(paths, environment);
  return {
    repository: repo,
    service: new CursorPermissionsService(
      repo,
      ProviderConnectionRepository.forWorkingDirectory(directory)
    ),
    environment,
  };
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-cursor-permissions-'));
  project = path.join(directory, 'project');
  await mkdir(project);
  ({ repository, service } = create());
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

it('previews exact global/project host files without creating them; snapshots environment per app', async () => {
  const first = create('first');
  const second = create('second');
  first.environment.CURSOR_CONFIG_DIR = path.join(directory, 'mutated');
  const global = await first.service.target('global');
  expect(global.target.configPath).toBe(path.join(directory, 'first', 'cli-config.json'));
  expect((await second.service.target('global')).target.instanceId).not.toBe(
    global.target.instanceId
  );
  expect((await service.target('project', project)).target).toMatchObject({
    scope: 'project',
    projectPath: project,
    configPath: path.join(project, '.cursor', 'cli.json'),
  });
  expect(await readdir(directory)).toEqual(['project']);
  await first.service.apply({ confirmed: true, target: global.target, profileId: 'strict' });
  expect((await second.service.read()).effectivePermissions).toBeNull();
});
it('preserves unrelated settings on global/profile/custom writes and permission deletion', async () => {
  const global = (await service.target('global')).target;
  await mkdir(path.dirname(global.configPath));
  await writeFile(
    global.configPath,
    JSON.stringify({ version: 1, editor: { vimMode: true }, model: { default: 'original' } })
  );
  await service.apply({ confirmed: true, target: global, profileId: 'development' });
  expect(JSON.parse(await readFile(global.configPath, 'utf8'))).toMatchObject({
    editor: { vimMode: true },
    model: { default: 'original' },
  });
  const target = (await service.target('project', project)).target;
  await mkdir(path.dirname(target.configPath));
  await writeFile(target.configPath, JSON.stringify({ rules: { keep: true } }));
  await service.custom({ confirmed: true, target, permissions });
  expect((await service.read(project)).effectivePermissions).toEqual(permissions);
  expect(JSON.parse(await readFile(target.configPath, 'utf8'))).toEqual({
    rules: { keep: true },
    permissions,
  });
  await service.delete({ confirmed: true, target });
  expect(JSON.parse(await readFile(target.configPath, 'utf8'))).toEqual({ rules: { keep: true } });
  expect((await service.read(project)).hasProjectConfig).toBe(false);
  expect((await service.read(project)).effectivePermissions).toEqual(
    CURSOR_PERMISSION_PROFILES.find((p) => p.id === 'development')!.permissions
  );
});
it('deletes an owned permissions-only project file idempotently and never deletes global config', async () => {
  const target = (await service.target('project', project)).target;
  await service.custom({ confirmed: true, target, permissions });
  await service.delete({ confirmed: true, target });
  await service.delete({ confirmed: true, target });
  expect(await readdir(path.dirname(target.configPath))).toEqual([]);
  expect(() =>
    service.delete({ confirmed: true, target: { ...target, scope: 'global' } } as never)
  ).toThrow();
});
it('does not mutate profile constants or caller permissions when detecting active profile', async () => {
  const before = structuredClone(CURSOR_PERMISSION_PROFILES);
  const target = (await service.target('global')).target;
  await service.apply({ confirmed: true, target, profileId: 'strict' });
  expect((await service.read()).activeProfile).toBe('strict');
  expect(CURSOR_PERMISSION_PROFILES).toEqual(before);
});
it('reads global fallback for a stale missing project without allowing a write preview or creating its directory', async () => {
  const target = (await service.target('global')).target;
  await service.apply({ confirmed: true, target, profileId: 'strict' });
  const removed = path.join(directory, 'removed-project');
  expect((await service.read(removed)).activeProfile).toBe('strict');
  await expect(service.target('project', removed)).rejects.toMatchObject({ statusCode: 404 });
  expect(await readdir(directory)).not.toContain('removed-project');
});
it.each(['instanceId', 'configPath', 'workingDirectory'] as const)(
  'rejects a stale %s before touching the file',
  async (field) => {
    const target = (await service.target('global')).target;
    const changed = {
      ...target,
      [field]:
        field === 'instanceId'
          ? '62f89322-63ec-40f7-90b1-ef76c55a47ee'
          : path.join(directory, 'other'),
    };
    await expect(
      service.apply({ confirmed: true, target: changed, profileId: 'strict' })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await readdir(directory)).toEqual(['project']);
  }
);
it.each([{}, { confirmed: false }, { confirmed: true, profileId: '__proto__' }])(
  'rejects implicit/invalid writes: %s',
  async (override) => {
    expect(() => service.apply(override as never)).toThrow();
    expect(await readdir(directory)).toEqual(['project']);
  }
);
it('rejects relative/missing/outside-root project paths and unknown scopes', async () => {
  await expect(service.target('project', project + String.fromCharCode(0))).rejects.toMatchObject({
    statusCode: 400,
  });
  await expect(service.target('project', '..')).rejects.toMatchObject({ statusCode: 400 });
  await expect(service.target('project', os.tmpdir())).rejects.toMatchObject({ statusCode: 403 });
  await expect(service.target('global', project)).rejects.toMatchObject({ statusCode: 400 });
  await expect(service.target('docker')).rejects.toMatchObject({ statusCode: 400 });
});
it.each(['{broken', '{"permissions":{"allow":[1],"deny":[]}}', '[]', 'x'.repeat(1024 * 1024 + 1)])(
  'fails closed on invalid existing JSON/config without replacing it (%#)',
  async (content) => {
    const target = (await service.target('global')).target;
    await mkdir(path.dirname(target.configPath));
    await writeFile(target.configPath, content);
    await expect(
      service.apply({ confirmed: true, target, profileId: 'strict' })
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(await readFile(target.configPath, 'utf8')).toBe(content);
    expect(await readdir(path.dirname(target.configPath))).toEqual(['cli-config.json']);
  }
);
it.skipIf(process.platform === 'win32')(
  'rejects config symlinks/hardlinks and project directory symlinks without changing their targets',
  async () => {
    const protectedFile = path.join(directory, 'protected.json');
    await writeFile(protectedFile, '{}');
    const target = (await service.target('global')).target;
    await mkdir(path.dirname(target.configPath));
    await symlink(protectedFile, target.configPath);
    await expect(
      service.apply({ confirmed: true, target, profileId: 'strict' })
    ).rejects.toMatchObject({ statusCode: 403 });
    await rm(target.configPath);
    await link(protectedFile, target.configPath);
    await expect(
      service.apply({ confirmed: true, target, profileId: 'strict' })
    ).rejects.toMatchObject({ statusCode: 403 });
    await symlink(path.dirname(target.configPath), path.join(project, '.cursor'));
    await expect(service.target('project', project)).rejects.toMatchObject({ statusCode: 403 });
    expect(await readFile(protectedFile, 'utf8')).toBe('{}');
  }
);
it('serializes accepted writes, drains them on shutdown and rejects new work', async () => {
  const target = (await service.target('global')).target;
  const write = repository.write.bind(repository);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  const spy = vi.spyOn(repository, 'write').mockImplementation(async (selected, value) => {
    calls.push(JSON.stringify(value));
    if (calls.length === 1) await gate;
    await write(selected, value);
  });
  const first = service.apply({ confirmed: true, target, profileId: 'strict' });
  const second = service.apply({ confirmed: true, target, profileId: 'development' });
  await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
  let closed = false;
  const closing = service.beforeApplicationShutdown().then(() => {
    closed = true;
  });
  await expect(service.target('global')).rejects.toMatchObject({ statusCode: 503 });
  await expect(
    service.apply({ confirmed: true, target, profileId: 'strict' })
  ).rejects.toMatchObject({ statusCode: 503 });
  expect(closed).toBe(false);
  release();
  await Promise.all([first, second, closing]);
  expect(closed).toBe(true);
  expect(calls).toHaveLength(2);
  expect(JSON.parse(await readFile(target.configPath, 'utf8')).permissions).toEqual(
    CURSOR_PERMISSION_PROFILES.find((p) => p.id === 'development')!.permissions
  );
});
it('recovers the file queue after a failed write', async () => {
  const target = (await service.target('global')).target;
  vi.spyOn(repository, 'write').mockRejectedValueOnce(new Error('fixture write failure'));
  await expect(service.apply({ confirmed: true, target, profileId: 'strict' })).rejects.toThrow(
    'fixture'
  );
  await service.apply({ confirmed: true, target, profileId: 'development' });
  expect((await service.read()).activeProfile).toBe('development');
});
