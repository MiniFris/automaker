import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it, vi } from 'vitest';
import {
  WorkspaceConfigResponseSchema,
  WorkspaceDirectoriesResponseSchema,
} from '@automaker/contracts/domains/workspace';
import { CloneTemplateResponseSchema } from '@automaker/contracts/domains/templates';
import { createNestApplication } from '../../src/main.js';
import {
  TEMPLATE_COMMAND_RUNNER,
  type TemplateCommandRunner,
} from '../../src/modules/templates/template-command.runner.js';
import { TemplatesService } from '../../src/modules/templates/templates.service.js';
import { WorkspaceService } from '../../src/modules/workspace/workspace.service.js';

type Runtime = Awaited<ReturnType<typeof createNestApplication>>;
async function start(root: string, data: string, allowedRoot?: string): Promise<Runtime> {
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: root,
    dataDir: data,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      USERPROFILE: root,
      XDG_CONFIG_HOME: path.join(root, 'config'),
      AUTOMAKER_API_KEY: 'workspace-contract-fixture',
      ...(allowedRoot && { ALLOWED_ROOT_DIRECTORY: allowedRoot }),
    },
  });
  await runtime.start();
  return runtime;
}
async function call(runtime: Runtime, route: string, body?: unknown) {
  const base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api`;
  const response = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-API-Key': 'workspace-contract-fixture', 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

it('validates real workspace listing and template workflow responses with an explicit offline command port', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automaker-workspace-response-'));
  let runtime: Runtime | undefined;
  try {
    const workspace = path.join(root, 'workspace');
    await mkdir(path.join(workspace, 'visible'), { recursive: true });
    await mkdir(path.join(workspace, '.hidden'));
    await writeFile(path.join(workspace, 'plain.txt'), 'not a directory');
    runtime = await start(root, path.join(root, 'data'), workspace);
    const runner = runtime.app.get<TemplateCommandRunner>(TEMPLATE_COMMAND_RUNNER);
    const run = vi.spyOn(runner, 'run').mockImplementation(async (command, args) => {
      expect(command).toBe('git');
      if (args[0] === 'clone') {
        const destination = args[2];
        await mkdir(path.join(destination, '.git'), { recursive: true });
        await writeFile(path.join(destination, 'fixture.txt'), 'offline command fixture');
      }
      return { exitCode: 0, stderr: '' };
    });
    const config = await call(runtime, '/workspace/config');
    expect(config.status).toBe(200);
    expect(WorkspaceConfigResponseSchema.parse(config.body)).toEqual({
      success: true,
      configured: true,
      workspaceDir: workspace,
      defaultDir: workspace,
    });
    const listed = await call(runtime, '/workspace/directories');
    expect(listed.status).toBe(200);
    expect(WorkspaceDirectoriesResponseSchema.parse(listed.body)).toEqual({
      success: true,
      directories: [{ name: 'visible', path: path.join(workspace, 'visible') }],
    });
    const cloned = await call(runtime, '/templates/clone', {
      repoUrl: 'https://github.com/offline-fixture/template',
      projectName: 'New project!',
      parentDir: workspace,
    });
    expect(cloned.status).toBe(200);
    expect(CloneTemplateResponseSchema.parse(cloned.body)).toEqual({
      success: true,
      projectPath: path.join(workspace, 'New-project-'),
      projectName: 'New-project-',
    });
    expect(run.mock.calls.map(([, args]) => args[0])).toEqual(['clone', 'init']);
    expect(await readFile(path.join(workspace, 'New-project-', 'fixture.txt'), 'utf8')).toBe(
      'offline command fixture'
    );
    run.mockClear();
    const denied = await call(runtime, '/templates/clone', {
      repoUrl: 'https://github.com/offline-fixture/template',
      projectName: 'Denied',
      parentDir: root,
    });
    expect(denied.status).toBe(403);
    expect(run).not.toHaveBeenCalled();
    const malformed = await call(runtime, '/templates/clone', {
      repoUrl: 'file:///not-a-network-call',
      projectName: 'Invalid',
      parentDir: workspace,
    });
    expect(malformed.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  } finally {
    await runtime?.app.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('preserves default-only and configured-root diagnostic success variants', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automaker-workspace-variants-'));
  try {
    const file = path.join(root, 'file');
    await writeFile(file, 'not a directory');
    const missing = path.join(root, 'missing');
    for (const [index, allowedRoot, expected] of [
      [0, undefined, { success: true, configured: false, defaultDir: path.join(root, 'data-0') }],
      [
        1,
        file,
        {
          success: true,
          configured: false,
          error: 'ALLOWED_ROOT_DIRECTORY is not a valid directory',
        },
      ],
      [
        2,
        missing,
        { success: true, configured: false, error: 'ALLOWED_ROOT_DIRECTORY path does not exist' },
      ],
    ] as const) {
      const runtime = await start(root, path.join(root, `data-${index}`), allowedRoot);
      try {
        const response = await call(runtime, '/workspace/config');
        expect(response.status).toBe(200);
        expect(WorkspaceConfigResponseSchema.parse(response.body)).toEqual(expected);
        if (!allowedRoot) expect((await call(runtime, '/workspace/directories')).status).toBe(400);
      } finally {
        await runtime.app.close();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects malformed application success payloads at all three native response boundaries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automaker-workspace-boundaries-'));
  const runtime = await start(root, path.join(root, 'data'), root);
  const workspace = runtime.app.get(WorkspaceService);
  const templates = runtime.app.get(TemplatesService);
  try {
    vi.spyOn(workspace, 'getConfig').mockResolvedValue({
      success: true,
      configured: false,
      defaultDir: root,
      error: 123,
    });
    vi.spyOn(workspace, 'listDirectories').mockResolvedValue({
      success: true,
      directories: [{ name: 'missing-path' }],
    });
    vi.spyOn(templates, 'clone').mockResolvedValue({
      success: true,
      projectPath: root,
      projectName: 123,
    });
    for (const response of [
      await call(runtime, '/workspace/config'),
      await call(runtime, '/workspace/directories'),
      await call(runtime, '/templates/clone', {
        repoUrl: 'https://github.com/offline-fixture/template',
        projectName: 'Fixture',
        parentDir: root,
      }),
    ]) {
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({ success: false, error: 'Internal server error.' });
    }
  } finally {
    vi.restoreAllMocks();
    await runtime.app.close();
    await rm(root, { recursive: true, force: true });
  }
});
