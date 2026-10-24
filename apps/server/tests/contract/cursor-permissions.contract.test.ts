import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import {
  API_CONTRACT_VERSION_HEADER,
  CursorPermissionsTargetResponseSchema,
} from '@automaker/contracts';
import { createNestApplication } from '../../src/main.js';

it('serves native Cursor permissions with versioned file-target consent, app isolation and fallback', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-cursor-permissions-http-'));
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
        CURSOR_CONFIG_DIR: path.join(root, 'cursor-profile'),
        ALLOWED_ROOT_DIRECTORY: directory,
      },
    });
    apps.push(runtime);
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const request = async (route: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/setup/${route}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      expect(response.headers.get(API_CONTRACT_VERSION_HEADER)).toBe('9');
      return { status: response.status, body: await response.json() };
    };
    return { runtime, request, root };
  };
  try {
    const first = await start('first');
    const second = await start('second');
    const preview = await first.request('cursor-permissions/target?scope=global');
    expect(preview.status).toBe(200);
    const { target } = CursorPermissionsTargetResponseSchema.parse(preview.body);
    expect(target.configPath).toBe(path.join(first.root, 'cursor-profile', 'cli-config.json'));
    expect(target.workingDirectory).toBe(first.root);
    const project = CursorPermissionsTargetResponseSchema.parse(
      (
        await first.request(
          `cursor-permissions/target?scope=project&projectPath=${encodeURIComponent(first.root)}`
        )
      ).body
    ).target;
    for (const body of [
      { profileId: 'strict', scope: 'global' },
      { profileId: 'strict', confirmed: false, target },
      { profileId: '__proto__', confirmed: true, target },
      { profileId: 'strict', confirmed: true, target, scope: 'project' },
    ])
      expect((await first.request('cursor-permissions/profile', 'POST', body)).status).toBe(400);
    expect(
      (
        await first.request('cursor-permissions/profile', 'POST', {
          confirmed: true,
          profileId: 'strict',
          target: { ...target, configPath: path.join(directory, 'other.json') },
        })
      ).status
    ).toBe(409);
    expect(
      (
        await second.request('cursor-permissions/profile', 'POST', {
          confirmed: true,
          profileId: 'strict',
          target,
        })
      ).status
    ).toBe(409);
    const applied = await first.request('cursor-permissions/profile', 'POST', {
      confirmed: true,
      profileId: 'strict',
      target,
    });
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({
      success: true,
      target,
      profileId: 'strict',
      scope: 'global',
    });
    expect((await first.request('cursor-permissions')).body.activeProfile).toBe('strict');
    expect((await second.request('cursor-permissions')).body.effectivePermissions).toBeNull();
    const permissions = { allow: ['Read(**)'], deny: ['Shell(rm)'] };
    expect(
      (
        await first.request('cursor-permissions/custom', 'POST', {
          confirmed: true,
          target,
          permissions,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await first.request('cursor-permissions/custom', 'POST', {
          confirmed: true,
          target: project,
          permissions,
        })
      ).body
    ).toMatchObject({ success: true, target: project, permissions });
    const read = await first.request(
      `cursor-permissions?projectPath=${encodeURIComponent(first.root)}`
    );
    expect(read.body).toMatchObject({
      effectivePermissions: permissions,
      activeProfile: 'custom',
      hasProjectConfig: true,
      globalTarget: target,
      projectTarget: project,
    });
    expect(
      (await first.request('cursor-permissions', 'DELETE', { confirmed: true, target })).status
    ).toBe(400);
    expect(
      (await first.request('cursor-permissions', 'DELETE', { confirmed: true, target: project }))
        .body
    ).toMatchObject({ success: true, target: project });
    expect(
      (await first.request(`cursor-permissions?projectPath=${encodeURIComponent(first.root)}`)).body
    ).toMatchObject({ activeProfile: 'strict', hasProjectConfig: false });
    expect(JSON.parse(await readFile(target.configPath, 'utf8')).permissions).toBeDefined();
    expect((await first.request('cursor-permissions/example')).body).toMatchObject({
      success: true,
      profileId: 'development',
    });
    expect((await first.request('cursor-permissions/example?profileId=invalid')).status).toBe(400);
  } finally {
    for (const runtime of apps) await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
