import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  rmdir,
  symlink,
  link,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RuntimePathsService } from '../../../src/core/config/index.js';
import { HostSetupJsonFiles } from '../../../src/modules/providers/host-setup-json-files.js';
import { CursorModelConfigService } from '../../../src/modules/providers/cursor-model-config.service.js';
import { ProviderConnectionRepository } from '../../../src/modules/providers/provider-connection.repository.js';
import { getAllCursorModelIds } from '@automaker/types';

let directory: string;
let project: string;
let files: HostSetupJsonFiles;
let service: CursorModelConfigService;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-cursor-model-config-'));
  project = path.join(directory, 'project');
  await mkdir(project);
  files = new HostSetupJsonFiles({
    allowedRootDirectory: directory,
    resolveFromWorkingDirectory: (...segments: string[]) => path.resolve(directory, ...segments),
  } as RuntimePathsService);
  service = new CursorModelConfigService(
    files,
    ProviderConnectionRepository.forWorkingDirectory(directory)
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

it('reads defaults without creating a directory or changing the model catalog', async () => {
  const read = await service.read(project);
  expect(read.target).toMatchObject({
    kind: 'host-cursor-model-config',
    projectPath: project,
    configPath: path.join(project, '.automaker', 'cursor-config.json'),
  });
  expect(read.config).toEqual({ defaultModel: 'cursor-auto', models: getAllCursorModelIds() });
  read.config.models?.pop();
  expect((await service.read(project)).config.models).toEqual(getAllCursorModelIds());
  expect(await readdir(project)).toEqual([]);
  const removed = path.join(directory, 'missing');
  expect((await service.read(removed)).config.defaultModel).toBe('cursor-auto');
  await expect(service.target(removed)).rejects.toMatchObject({ statusCode: 404 });
  expect(await readdir(directory)).toEqual(['project']);
});
it('preserves MCP/rules and unknown settings through both native mutations and restart', async () => {
  const target = (await service.target(project)).target;
  await mkdir(path.dirname(target.configPath));
  const saved = {
    defaultModel: 'legacy-auto',
    models: ['legacy-model'],
    mcpServers: ['server'],
    rules: ['rules/file'],
    future: { keep: true },
  };
  await writeFile(target.configPath, JSON.stringify(saved));
  expect((await service.read(project)).config).toEqual(saved);
  await service.setDefaultModel({ confirmed: true, target, model: 'cursor-auto' });
  await service.setEnabledModels({
    confirmed: true,
    target,
    models: ['cursor-auto', 'cursor-sonnet-4.6'],
  });
  const restarted = new CursorModelConfigService(
    files,
    ProviderConnectionRepository.forWorkingDirectory(directory)
  );
  expect((await restarted.read(project)).config).toEqual({
    ...saved,
    defaultModel: 'cursor-auto',
    models: ['cursor-auto', 'cursor-sonnet-4.6'],
  });
  await expect(
    restarted.setDefaultModel({ confirmed: true, target, model: 'cursor-auto' })
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(await readdir(path.dirname(target.configPath))).toEqual(['cursor-config.json']);
});
it.each(['instanceId', 'workingDirectory', 'configPath', 'projectPath'] as const)(
  'rejects stale %s before writing',
  async (field) => {
    const target = (await service.target(project)).target;
    const changed = {
      ...target,
      [field]:
        field === 'instanceId'
          ? '62f89322-63ec-40f7-90b1-ef76c55a47ee'
          : field === 'projectPath'
            ? directory
            : path.join(directory, 'changed'),
    };
    await expect(
      service.setDefaultModel({ confirmed: true, target: changed, model: 'cursor-auto' })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await readdir(project)).toEqual([]);
  }
);
it.each(['constructor', '__proto__', 'cursor-nonexistent'])(
  'rejects non-catalog model %s without a prototype membership bypass',
  async (model) => {
    const target = (await service.target(project)).target;
    expect(() => service.setDefaultModel({ confirmed: true, target, model })).toThrow();
    expect(() =>
      service.setEnabledModels({ confirmed: true, target, models: ['cursor-auto', model] })
    ).toThrow();
    expect(await readdir(project)).toEqual([]);
  }
);
it('requires confirmation and a non-empty list; does not silently filter invalid models', async () => {
  const target = (await service.target(project)).target;
  expect(() => service.setDefaultModel({ target, model: 'cursor-auto' } as never)).toThrow();
  expect(() => service.setEnabledModels({ confirmed: true, target, models: [] })).toThrow();
  expect(() =>
    service.setEnabledModels({ confirmed: false, target, models: ['cursor-auto'] } as never)
  ).toThrow();
  expect(await readdir(project)).toEqual([]);
});
it.each(['{broken', '[]', '{"models":[3]}', 'x'.repeat(1024 * 1024 + 1)])(
  'fails closed on an invalid existing model config (%#)',
  async (content) => {
    const target = (await service.target(project)).target;
    await mkdir(path.dirname(target.configPath));
    await writeFile(target.configPath, content);
    await expect(service.read(project)).rejects.toMatchObject({ statusCode: 503 });
    await expect(
      service.setDefaultModel({ confirmed: true, target, model: 'cursor-auto' })
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(await readFile(target.configPath, 'utf8')).toBe(content);
  }
);
it('rejects relative/null/outside-root project paths and config filename traversal', async () => {
  await expect(service.target('../project')).rejects.toMatchObject({ statusCode: 400 });
  await expect(service.target(project + String.fromCharCode(0))).rejects.toMatchObject({
    statusCode: 400,
  });
  await expect(service.target(os.tmpdir())).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    files.projectLocation(project, '.automaker', '../outside.json')
  ).rejects.toMatchObject({ statusCode: 400 });
});
it.skipIf(process.platform === 'win32')(
  'rejects .automaker/file symlinks and hardlinks without modifying protected files',
  async () => {
    const protectedFile = path.join(directory, 'protected.json');
    await writeFile(protectedFile, '{}');
    const target = (await service.target(project)).target;
    await mkdir(path.dirname(target.configPath));
    await symlink(protectedFile, target.configPath);
    await expect(
      service.setDefaultModel({ confirmed: true, target, model: 'cursor-auto' })
    ).rejects.toMatchObject({ statusCode: 403 });
    await rm(target.configPath);
    await link(protectedFile, target.configPath);
    await expect(service.read(project)).rejects.toMatchObject({ statusCode: 403 });
    await rm(target.configPath);
    await rmdir(path.dirname(target.configPath));
    await symlink(directory, path.dirname(target.configPath));
    await expect(service.target(project)).rejects.toMatchObject({ statusCode: 403 });
    expect(await readFile(protectedFile, 'utf8')).toBe('{}');
  }
);
it('serializes both operations, drains accepted writes at shutdown and closes admission', async () => {
  const target = (await service.target(project)).target;
  const replace = files.replace.bind(files);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  vi.spyOn(files, 'replace').mockImplementation(async (file, value) => {
    if (++writes === 1) await gate;
    await replace(file, value);
  });
  const first = service.setDefaultModel({ confirmed: true, target, model: 'cursor-sonnet-4.6' });
  const second = service.setEnabledModels({ confirmed: true, target, models: ['cursor-auto'] });
  await vi.waitFor(() => expect(writes).toBe(1));
  let closed = false;
  const closing = service.beforeApplicationShutdown().then(() => {
    closed = true;
  });
  await expect(service.target(project)).rejects.toMatchObject({ statusCode: 503 });
  await expect(
    service.setDefaultModel({ confirmed: true, target, model: 'cursor-auto' })
  ).rejects.toMatchObject({ statusCode: 503 });
  expect(closed).toBe(false);
  release();
  await Promise.all([first, second, closing]);
  expect(JSON.parse(await readFile(target.configPath, 'utf8'))).toMatchObject({
    defaultModel: 'cursor-sonnet-4.6',
    models: ['cursor-auto'],
  });
});
it('does not poison the file queue after a failed write', async () => {
  const target = (await service.target(project)).target;
  vi.spyOn(files, 'replace').mockRejectedValueOnce(new Error('fixture failure'));
  await expect(
    service.setDefaultModel({ confirmed: true, target, model: 'cursor-auto' })
  ).rejects.toThrow('fixture failure');
  await service.setEnabledModels({ confirmed: true, target, models: ['cursor-auto'] });
  expect((await service.read(project)).config.models).toEqual(['cursor-auto']);
});
