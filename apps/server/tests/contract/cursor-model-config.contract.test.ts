import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import {
  CursorModelConfigResponseSchema,
  CursorModelConfigTargetResponseSchema,
  API_CONTRACT_VERSION_HEADER,
} from '@automaker/contracts';
import { createNestApplication } from '../../src/main.js';
import { SetupHandlersService } from '../../src/modules/providers/setup-handlers.service.js';
import { SettingsService } from '../../src/services/settings-service.js';

it('serves native project model config with target consent, app isolation and no changes to global model settings', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-model-config-http-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const start = async (name: string) => {
    const root = path.join(directory, name);
    await mkdir(root);
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: root,
      dataDir: path.join(root, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'fixture-api-key',
        ENABLE_REQUEST_LOGGING: 'false',
        ALLOWED_ROOT_DIRECTORY: directory,
        CURSOR_CONFIG_DIR: path.join(root, 'cursor'),
      },
    });
    apps.push(runtime);
    const bridge = vi.spyOn(runtime.app.get(SetupHandlersService), 'run');
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const request = async (route: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/setup/${route}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      expect(response.headers.get(API_CONTRACT_VERSION_HEADER)).toBe('7');
      return { status: response.status, body: await response.json() };
    };
    return { runtime, root, request, bridge };
  };
  try {
    const first = await start('first');
    const second = await start('second');
    const before = await first.runtime.app.get(SettingsService).getGlobalSettings();
    const route = `cursor-config?projectPath=${encodeURIComponent(first.root)}`;
    const read = await first.request(route);
    expect(read.status).toBe(200);
    expect(CursorModelConfigResponseSchema.parse(read.body).config.defaultModel).toBe(
      'cursor-auto'
    );
    const { target } = CursorModelConfigTargetResponseSchema.parse(
      (await first.request(`cursor-config/target?projectPath=${encodeURIComponent(first.root)}`))
        .body
    );
    expect(target).toMatchObject({
      projectPath: first.root,
      configPath: path.join(first.root, '.automaker', 'cursor-config.json'),
    });
    for (const body of [
      { projectPath: first.root, model: 'cursor-auto' },
      { confirmed: false, target, model: 'cursor-auto' },
      { confirmed: true, target, model: 'constructor' },
      { confirmed: true, target, model: 'cursor-nonexistent' },
    ])
      expect((await first.request('cursor-config/default-model', 'POST', body)).status).toBe(400);
    expect(
      (
        await second.request('cursor-config/default-model', 'POST', {
          confirmed: true,
          target,
          model: 'cursor-auto',
        })
      ).status
    ).toBe(409);
    await mkdir(path.dirname(target.configPath), { recursive: true });
    await writeFile(
      target.configPath,
      JSON.stringify({ mcpServers: ['server'], rules: ['rules/file'], custom: 'keep' })
    );
    const setDefault = await first.request('cursor-config/default-model', 'POST', {
      confirmed: true,
      target,
      model: 'cursor-sonnet-4.6',
    });
    expect(setDefault.status).toBe(200);
    expect(setDefault.body).toEqual({ success: true, target, model: 'cursor-sonnet-4.6' });
    expect(
      (
        await first.request('cursor-config/models', 'POST', {
          confirmed: true,
          target,
          models: ['cursor-auto', 'cursor-nonexistent'],
        })
      ).status
    ).toBe(400);
    const enabled = await first.request('cursor-config/models', 'POST', {
      confirmed: true,
      target,
      models: ['cursor-auto'],
    });
    expect(enabled.status).toBe(200);
    expect(enabled.body).toEqual({ success: true, target, models: ['cursor-auto'] });
    expect(JSON.parse(await readFile(target.configPath, 'utf8'))).toEqual({
      mcpServers: ['server'],
      rules: ['rules/file'],
      custom: 'keep',
      defaultModel: 'cursor-sonnet-4.6',
      models: ['cursor-auto'],
    });
    expect((await first.request(route)).body.config.defaultModel).toBe('cursor-sonnet-4.6');
    expect(
      (await second.request(`cursor-config?projectPath=${encodeURIComponent(second.root)}`)).body
        .config.defaultModel
    ).toBe('cursor-auto');
    const after = await first.runtime.app.get(SettingsService).getGlobalSettings();
    expect(after.cursorDefaultModel).toBe(before.cursorDefaultModel);
    expect(after.enabledCursorModels).toEqual(before.enabledCursorModels);
    expect(first.bridge).not.toHaveBeenCalled();
    expect(second.bridge).not.toHaveBeenCalled();
  } finally {
    for (const runtime of apps) await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
