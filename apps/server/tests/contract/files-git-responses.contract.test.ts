import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { FilesQueryService } from '../../src/modules/files/files-query.service.js';
import { FilesCommandService } from '../../src/modules/files/files-command.service.js';
import {
  PROJECT_FILE_PORT,
  type ProjectFilePort,
} from '../../src/modules/files/project-file.port.js';
import { GitApplicationService } from '../../src/modules/git/git-application.service.js';
import { GitController } from '../../src/modules/git/git.controller.js';
import { ExecutionEnvironmentError } from '../../src/services/execution-environment/runtime.js';

const exec = promisify(execFile);
let root: string;
const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-fs-git-response-'));
});
afterEach(async () => {
  const results = await Promise.allSettled(apps.splice(0).map((owner) => owner.app.close()));
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
  for (const result of results) if (result.status === 'rejected') throw result.reason;
});
async function start() {
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  const owner = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ALLOWED_ROOT_DIRECTORY: root,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  apps.push(owner);
  await owner.start();
  const port = owner.app.getHttpServer().address().port;
  const headers = { 'content-type': 'application/json', 'x-api-key': 'fixture' };
  const raw = (route: string, body: object) =>
    fetch(`http://127.0.0.1:${port}/api/${route}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  const post = async (route: string, body: object) => {
    const response = await raw(route, body);
    return { status: response.status, body: await response.json() };
  };
  return {
    ...owner,
    project,
    raw,
    post,
    get: (route: string) =>
      fetch(`http://127.0.0.1:${port}/api/${route}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      }),
  };
}

it('serves all 16 filesystem JSON operations with actual native files, dates and path variants', async () => {
  const owner = await start(),
    file = path.join(owner.project, 'file.txt'),
    nested = path.join(owner.project, 'nested');
  expect(await owner.post('fs/write', { filePath: file, content: '' })).toEqual({
    status: 200,
    body: { success: true },
  });
  expect(await owner.post('fs/read', { filePath: file })).toEqual({
    status: 200,
    body: { success: true, content: '' },
  });
  const date = new Date('2001-02-03T04:05:06.000Z');
  await fs.utimes(file, date, date);
  expect(await owner.post('fs/stat', { filePath: file })).toEqual({
    status: 200,
    body: {
      success: true,
      stats: { isDirectory: false, isFile: true, size: 0, mtime: date.toJSON() },
    },
  });
  expect(await owner.post('fs/exists', { filePath: file })).toEqual({
    status: 200,
    body: { success: true, exists: true },
  });
  expect(await owner.post('fs/exists', { filePath: file + '.missing' })).toEqual({
    status: 200,
    body: { success: true, exists: false },
  });
  expect(await owner.post('fs/mkdir', { dirPath: nested })).toMatchObject({
    status: 200,
    body: { success: true },
  });
  expect(await owner.post('fs/stat', { filePath: nested })).toMatchObject({
    status: 200,
    body: { stats: { isDirectory: true, isFile: false } },
  });
  expect(await owner.post('fs/readdir', { dirPath: owner.project })).toMatchObject({
    status: 200,
    body: {
      entries: [
        { name: 'file.txt', isDirectory: false, isFile: true },
        { name: 'nested', isDirectory: true, isFile: false },
      ],
    },
  });
  expect(await owner.post('fs/validate-path', { filePath: nested })).toEqual({
    status: 200,
    body: { success: true, path: nested, isAllowed: true },
  });
  expect(await owner.post('fs/browse', { dirPath: owner.project })).toEqual({
    status: 200,
    body: {
      success: true,
      currentPath: owner.project,
      parentPath: root,
      directories: [{ name: 'nested', path: nested }],
      drives: [],
    },
  });
  expect(await owner.post('fs/browse', { dirPath: root })).toMatchObject({
    status: 200,
    body: { parentPath: null },
  });
  expect(await owner.post('fs/browse-project-files', { projectPath: owner.project })).toMatchObject(
    {
      status: 200,
      body: {
        currentRelativePath: '',
        parentRelativePath: null,
        entries: [
          { name: 'nested', relativePath: 'nested' },
          { name: 'file.txt', relativePath: 'file.txt' },
        ],
      },
    }
  );
  expect(
    await owner.post('fs/browse-project-files', {
      projectPath: owner.project,
      relativePath: 'nested',
    })
  ).toEqual({
    status: 200,
    body: { success: true, currentRelativePath: 'nested', parentRelativePath: '', entries: [] },
  });
  expect(await owner.post('fs/resolve-directory', { directoryName: owner.project })).toEqual({
    status: 200,
    body: { success: true, path: owner.project },
  });
  const copy = path.join(nested, 'copy.txt'),
    moved = path.join(nested, 'moved.txt');
  expect(await owner.post('fs/copy', { sourcePath: file, destinationPath: copy })).toEqual({
    status: 200,
    body: { success: true },
  });
  expect(await owner.post('fs/move', { sourcePath: copy, destinationPath: moved })).toEqual({
    status: 200,
    body: { success: true },
  });
  expect(await owner.post('fs/delete', { filePath: moved })).toEqual({
    status: 200,
    body: { success: true },
  });
  await expect(fs.stat(moved)).rejects.toMatchObject({ code: 'ENOENT' });
  const image = {
    projectPath: owner.project,
    filename: 'fixture.png',
    data: Buffer.from('image-fixture').toString('base64'),
  };
  const saved = await owner.post('fs/save-image', image),
    background = await owner.post('fs/save-board-background', image);
  for (const result of [saved, background]) {
    expect(result).toMatchObject({
      status: 200,
      body: { success: true, path: expect.any(String) },
    });
    expect(await fs.readFile(result.body.path, 'utf8')).toBe('image-fixture');
  }
  expect(await owner.post('fs/delete-board-background', { projectPath: owner.project })).toEqual({
    status: 200,
    body: { success: true },
  });
  await expect(fs.stat(background.body.path)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('preserves filesystem warnings and existing failure precedence', async () => {
  const owner = await start(),
    port = owner.app.get<ProjectFilePort>(PROJECT_FILE_PORT),
    file = path.join(owner.project, 'missing');
  expect(await owner.post('fs/read', { filePath: file })).toMatchObject({
    status: 404,
    body: { error: 'File not found.' },
  });
  expect(await owner.post('fs/stat', { filePath: file })).toMatchObject({
    status: 404,
    body: { error: 'File or directory not found' },
  });
  expect(await owner.post('fs/validate-path', { filePath: file })).toMatchObject({
    status: 400,
    body: { error: 'Path does not exist' },
  });
  expect(await owner.post('fs/read', { filePath: path.dirname(root) })).toMatchObject({
    status: 403,
  });
  expect(await owner.post('fs/read', {})).toMatchObject({ status: 400 });
  const stat = vi
    .spyOn(port, 'stat')
    .mockResolvedValue({ isDirectory: true, isFile: false, size: 0, mtime: new Date() });
  const list = vi
    .spyOn(port, 'list')
    .mockRejectedValue(Object.assign(new Error('fixture denied'), { code: 'EACCES' }));
  expect(await owner.post('fs/browse', { dirPath: owner.project })).toMatchObject({
    status: 200,
    body: { directories: [], warning: 'Permission denied - unable to read this directory' },
  });
  stat.mockRestore();
  list.mockRestore();
  vi.spyOn(port, 'read').mockRejectedValue(Object.assign(new Error('fixture IO'), { code: 'EIO' }));
  expect(await owner.post('fs/read', { filePath: file })).toMatchObject({
    status: 502,
    body: { success: false, errorCode: 'UNKNOWN_OUTCOME' },
  });
  await fs.writeFile(file, 'owned');
  expect(
    await owner.post('fs/copy', { sourcePath: file, destinationPath: file + '.copy' })
  ).toMatchObject({ status: 200 });
  expect(
    await owner.post('fs/copy', { sourcePath: file, destinationPath: file + '.copy' })
  ).toMatchObject({ status: 409, body: { error: 'Destination already exists' } });
  await owner.app.get(FilesCommandService).onModuleDestroy();
  expect(await owner.post('fs/write', { filePath: file, content: 'no' })).toMatchObject({
    status: 503,
    body: { error: 'File commands are closing.' },
  });
});

it('keeps image and file/directory downloads binary with their actual bytes and headers', async () => {
  const owner = await start(),
    file = path.join(owner.project, 'fixture.png'),
    directory = path.join(owner.project, 'archive');
  await fs.writeFile(file, 'binary-fixture');
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'hello.txt'), 'zip-fixture');
  const image = await owner.get(`fs/image?path=${encodeURIComponent(file)}`);
  expect(image.status).toBe(200);
  expect(image.headers.get('content-type')).toBe('image/png');
  expect(image.headers.get('cache-control')).toBe('public, max-age=3600');
  expect(await image.text()).toBe('binary-fixture');
  const plain = await owner.raw('fs/download', { filePath: file });
  expect(plain.status).toBe(200);
  expect(plain.headers.get('content-type')).toBe('application/octet-stream');
  expect(plain.headers.get('content-disposition')).toContain('fixture.png');
  expect(await plain.text()).toBe('binary-fixture');
  const zipped = await owner.raw('fs/download', { filePath: directory });
  expect(zipped.status).toBe(200);
  expect(zipped.headers.get('content-type')).toBe('application/zip');
  expect(zipped.headers.get('content-disposition')).toContain('archive.zip');
  expect(
    strFromU8(unzipSync(new Uint8Array(await zipped.arrayBuffer()))['archive/hello.txt'])
  ).toBe('zip-fixture');
});

async function git(cwd: string, ...args: string[]) {
  return exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], {
    cwd,
    timeout: 5000,
  });
}
it('serves all six Git JSON operations through the real offline target worker', async () => {
  const owner = await start(),
    input = { projectPath: owner.project };
  await git(owner.project, 'init', '--initial-branch=main');
  await git(owner.project, 'config', 'user.name', 'Fixture');
  await git(owner.project, 'config', 'user.email', 'fixture@example.test');
  const environment = await owner.post('git/environment', input);
  expect(environment).toMatchObject({
    status: 200,
    body: {
      success: true,
      executionEnvironment: {
        type: 'local',
        projectPath: owner.project,
        path: owner.project,
        root: owner.project,
        runtimeCwd: owner.project,
        pinned: false,
        targetId: expect.any(String),
      },
    },
  });
  expect(await owner.post('git/diffs', input)).toMatchObject({
    status: 200,
    body: { files: [], hasChanges: false, diff: '' },
  });
  expect(await owner.post('git/details', input)).toMatchObject({
    status: 200,
    body: { details: { branch: 'main' } },
  });
  await fs.writeFile(path.join(owner.project, 'new [] file.txt'), 'new\n');
  const file = { ...input, filePath: 'new [] file.txt' };
  expect(await owner.post('git/details', file)).toMatchObject({
    status: 200,
    body: {
      details: {
        lastCommitHash: '',
        lastCommitTimestamp: '',
        isStaged: false,
        statusLabel: 'Untracked',
      },
    },
  });
  expect(await owner.post('git/file-diff', file)).toMatchObject({
    status: 200,
    body: { filePath: file.filePath, diff: expect.stringContaining('+new') },
  });
  expect(await owner.post('git/enhanced-status', input)).toMatchObject({
    status: 200,
    body: {
      branch: 'main',
      files: [
        {
          path: file.filePath,
          isConflicted: false,
          linesAdded: 0,
          linesRemoved: 0,
          statusLabel: 'Untracked',
        },
      ],
    },
  });
  for (const operation of ['stage', 'unstage', 'stage'])
    expect(
      await owner.post('git/stage-files', { ...input, files: [file.filePath], operation })
    ).toMatchObject({ status: 200, body: { result: { operation, filesCount: 1 } } });
  await git(owner.project, 'commit', '-m', 'Initial fixture');
  await fs.writeFile(path.join(owner.project, file.filePath), 'changed\n');
  expect(await owner.post('git/diffs', input)).toMatchObject({
    status: 200,
    body: {
      hasChanges: true,
      files: [{ path: file.filePath, statusText: 'Modified', isMergeAffected: false }],
      diff: expect.stringContaining('+changed'),
    },
  });
  expect(await owner.post('git/details', file)).toMatchObject({
    status: 200,
    body: {
      details: {
        lastCommitHash: expect.any(String),
        lastCommitMessage: 'Initial fixture',
        lastCommitAuthor: 'Fixture',
        lastCommitTimestamp: expect.any(String),
        linesAdded: 1,
        linesRemoved: 1,
        isUnstaged: true,
      },
    },
  });
  await git(owner.project, 'restore', '--', file.filePath);
  await git(owner.project, 'checkout', '-b', 'side');
  await fs.writeFile(path.join(owner.project, file.filePath), 'side\n');
  await git(owner.project, 'commit', '-am', 'Side fixture');
  await git(owner.project, 'checkout', 'main');
  await fs.writeFile(path.join(owner.project, file.filePath), 'main\n');
  await git(owner.project, 'commit', '-am', 'Main fixture');
  await expect(git(owner.project, 'merge', 'side')).rejects.toBeDefined();
  expect(await owner.post('git/diffs', input)).toMatchObject({
    status: 200,
    body: {
      mergeState: {
        isMerging: true,
        mergeOperationType: 'merge',
        isCleanMerge: false,
        mergeAffectedFiles: [file.filePath],
        conflictFiles: [file.filePath],
      },
      files: [{ isMergeAffected: true }],
    },
  });
  expect(await owner.post('git/details', file)).toMatchObject({
    status: 200,
    body: { details: { isConflicted: true } },
  });
});

it('rejects malformed application success for all 22 JSON routes', async () => {
  const owner = await start(),
    query = owner.app.get(FilesQueryService),
    command = owner.app.get(FilesCommandService),
    gitApp = owner.app.get(GitApplicationService);
  const file = { filePath: path.join(owner.project, 'file') },
    project = { projectPath: owner.project },
    transfer = { sourcePath: file.filePath, destinationPath: file.filePath + '.copy' },
    image = { ...project, filename: 'fixture.png', data: 'eA==' };
  const environment = {
    type: 'local',
    projectPath: owner.project,
    path: owner.project,
    runtimeCwd: owner.project,
    root: owner.project,
    targetId: 'fixture',
    pinned: false,
  };
  const envelope = { success: true, executionEnvironment: environment };
  const cases: Array<[string, object, object, string, object]> = [
    ['fs/read', file, query, 'read', { success: true, content: null }],
    ['fs/readdir', { dirPath: owner.project }, query, 'list', { success: true, entries: [{}] }],
    [
      'fs/stat',
      file,
      query,
      'stat',
      { success: true, stats: { isDirectory: false, isFile: true, size: 0, mtime: 'bad' } },
    ],
    ['fs/exists', file, query, 'exists', { success: true, exists: 'false' }],
    ['fs/validate-path', file, query, 'validatePath', { success: true, path: file.filePath }],
    [
      'fs/browse',
      {},
      query,
      'browse',
      {
        success: true,
        currentPath: owner.project,
        parentPath: null,
        directories: [{}],
        drives: [],
      },
    ],
    [
      'fs/browse-project-files',
      project,
      query,
      'browseProject',
      { success: true, currentRelativePath: '', parentRelativePath: null, entries: [{}] },
    ],
    [
      'fs/resolve-directory',
      { directoryName: owner.project },
      query,
      'resolveDirectory',
      { success: true },
    ],
    ['fs/write', { ...file, content: 'x' }, command, 'write', { success: false }],
    ['fs/mkdir', { dirPath: owner.project }, command, 'mkdir', { success: false }],
    ['fs/delete', file, command, 'remove', { success: false }],
    ['fs/copy', transfer, command, 'copy', { success: false }],
    ['fs/move', transfer, command, 'move', { success: false }],
    ['fs/save-image', image, command, 'saveImage', { success: true }],
    ['fs/save-board-background', image, command, 'saveImage', { success: true, path: 1 }],
    ['fs/delete-board-background', project, command, 'deleteBoardBackground', { success: false }],
    [
      'git/environment',
      project,
      gitApp,
      'environment',
      { success: true, executionEnvironment: {} },
    ],
    [
      'git/diffs',
      project,
      gitApp,
      'diffs',
      { ...envelope, files: [{}], hasChanges: true, diff: '' },
    ],
    [
      'git/file-diff',
      { ...project, filePath: 'x' },
      gitApp,
      'fileDiff',
      { ...envelope, filePath: 'x', diff: null },
    ],
    [
      'git/stage-files',
      { ...project, files: ['x'], operation: 'stage' },
      gitApp,
      'stageFiles',
      { ...envelope, result: { operation: 'stage', filesCount: -1 } },
    ],
    [
      'git/details',
      project,
      gitApp,
      'details',
      { ...envelope, details: { branch: 'main', lastCommitHash: 1 } },
    ],
    [
      'git/enhanced-status',
      project,
      gitApp,
      'enhancedStatus',
      { ...envelope, branch: 'main', files: [{}] },
    ],
  ];
  for (const [route, input, service, method, response] of cases) {
    const spy = vi
      .spyOn(service as Record<string, (...args: unknown[]) => unknown>, method)
      .mockResolvedValue(response);
    try {
      expect(await owner.post(route, input), route).toMatchObject({
        status: 500,
        body: { success: false, error: 'Internal server error.' },
      });
    } finally {
      spy.mockRestore();
    }
  }
});

it('preserves Git errors and disconnect cancellation cleanup before response parsing', async () => {
  const owner = await start(),
    app = owner.app.get(GitApplicationService),
    project = { projectPath: owner.project };
  const error = new ExecutionEnvironmentError('GIT_TARGET_CHANGED', 'fixture target changed');
  vi.spyOn(app, 'diffs').mockRejectedValue(error);
  expect(await owner.post('git/diffs', project)).toMatchObject({
    status: 400,
    body: { success: false, error: 'fixture target changed', code: 'GIT_TARGET_CHANGED' },
  });
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
  }) as unknown as Response;
  let signal!: AbortSignal;
  vi.spyOn(app, 'fileDiff').mockImplementation(async (_input, captured) => {
    signal = captured;
    await new Promise<void>((resolve) =>
      captured.addEventListener('abort', () => resolve(), { once: true })
    );
    throw error;
  });
  const pending = owner.app.get(GitController).fileDiff({ ...project, filePath: 'x' }, response);
  expect(response.listenerCount('close')).toBe(1);
  response.emit('close');
  await expect(pending).rejects.toBe(error);
  expect(signal.aborted).toBe(true);
  expect(response.listenerCount('close')).toBe(0);
  vi.spyOn(app, 'details').mockResolvedValue({ success: true });
  await expect(owner.app.get(GitController).details(project, response)).rejects.toBeDefined();
  expect(response.listenerCount('close')).toBe(0);
});
