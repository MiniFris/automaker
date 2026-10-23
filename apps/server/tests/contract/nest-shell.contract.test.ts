import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  API_CONTRACT_VERSION,
  API_CONTRACT_VERSION_HEADER,
  HealthResponseSchema,
} from '@automaker/contracts';
import { afterAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { createNestApplication } from '../../src/main.js';
import {
  assertSingleRouteOwner,
  getApiRouteGroup,
  ROUTE_GROUP_OWNERS,
} from '../../src/legacy/legacy-router.middleware.js';
import { LEGACY_APPLICATION, LEGACY_SERVICES } from '../../src/legacy/legacy.tokens.js';
import { SettingsService } from '../../src/services/settings-service.js';

const execFileAsync = promisify(execFile);

const runtime = await createNestApplication({
  host: '127.0.0.1',
  port: 0,
  runStartupTasks: false,
  enableShutdownHooks: false,
});

afterAll(async () => {
  await runtime.app.close();
});

describe('Nest shell and legacy bridge contract', () => {
  it('creates the application without listening and shares one HTTP server', () => {
    expect(runtime.app.getHttpServer()).toBe(runtime.legacy.server);
    expect(runtime.legacy.server.listening).toBe(false);
    expect(runtime.app.get(LEGACY_APPLICATION)).toBe(runtime.legacy);
  });

  it('registers the existing stateful service instances without duplicates', () => {
    const services = runtime.legacy.services;
    const expected = {
      settings: services.settingsService,
      agent: services.agentService,
      featureLoader: services.featureLoader,
      autoMode: services.autoModeService,
      claudeUsage: services.claudeUsageService,
      codexAppServer: services.codexAppServerService,
      codexModelCache: services.codexModelCacheService,
      codexUsage: services.codexUsageService,
      zaiUsage: services.zaiUsageService,
      geminiUsage: services.geminiUsageService,
      mcpTest: services.mcpTestService,
      ideation: services.ideationService,
      devServer: services.devServerService,
      notification: services.notificationService,
      eventHistory: services.eventHistoryService,
      testRunner: services.testRunnerService,
      terminal: services.terminalService,
      pipeline: services.pipelineService,
      eventHook: services.eventHookService,
      loginAttemptStore: services.loginAttemptStore,
    };

    for (const [name, token] of Object.entries(LEGACY_SERVICES)) {
      expect(runtime.app.get(token), name).toBe(expected[name as keyof typeof expected]);
    }
    expect(runtime.app.get(SettingsService)).toBe(services.settingsService);
  });

  it('has one explicit owner for every API route group', () => {
    expect(() => assertSingleRouteOwner(ROUTE_GROUP_OWNERS)).not.toThrow();
    expect(Object.values(ROUTE_GROUP_OWNERS)).toEqual(expect.arrayContaining(['legacy']));
    expect(getApiRouteGroup({ originalUrl: '/api/features/feature-1?tab=plan' })).toBe('features');
    expect(getApiRouteGroup({ originalUrl: '/not-api/features' })).toBeUndefined();
  });

  it('serves the unchanged public health contract through Nest', async () => {
    await runtime.start();
    const address = runtime.legacy.server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get(API_CONTRACT_VERSION_HEADER)).toBe(API_CONTRACT_VERSION);
    expect(HealthResponseSchema.parse(await response.json())).toMatchObject({ status: 'ok' });

    const live = await fetch(`http://127.0.0.1:${address.port}/api/health/live`, {
      headers: { 'x-request-id': 'stage-3-live-check' },
    });
    expect(live.status).toBe(200);
    expect(live.headers.get('x-request-id')).toBe('stage-3-live-check');
    expect(await live.json()).toMatchObject({ status: 'ok' });

    const corsLive = await fetch(`http://127.0.0.1:${address.port}/api/health/live`, {
      headers: { Origin: 'http://localhost:4173' },
    });
    expect(corsLive.headers.get('access-control-allow-origin')).toBe('http://localhost:4173');
    expect(corsLive.headers.get('access-control-allow-credentials')).toBe('true');

    const ready = await fetch(`http://127.0.0.1:${address.port}/api/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: 'ready' });

    const detailedUrl = `http://127.0.0.1:${address.port}/api/health/detailed`;
    const unauthenticated = await fetch(detailedUrl);
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({
      success: false,
      error: 'Authentication required.',
      errorCode: 'UNAUTHORIZED',
    });

    const invalid = await fetch(detailedUrl, { headers: { 'x-api-key': 'invalid' } });
    expect(invalid.status).toBe(403);
    const apiKeyResponse = await fetch(detailedUrl, {
      headers: { 'x-api-key': 'automaker-test-api-key' },
    });
    expect(apiKeyResponse.status).toBe(200);

    const login = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'automaker-test-api-key' }),
    });
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
    expect(cookie).toBeTruthy();
    const cookieResponse = await fetch(detailedUrl, { headers: { Cookie: cookie! } });
    expect(cookieResponse.status).toBe(200);
  });

  it('preserves content-type, authentication, CORS, cookie and body-limit middleware', async () => {
    const address = runtime.legacy.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const protectedResponse = await fetch(`${baseUrl}/api/settings/status`);
    expect(protectedResponse.status).toBe(401);

    const missingContentType = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'automaker-test-api-key' }),
    });
    expect(missingContentType.status).toBe(415);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'automaker-test-api-key' }),
    });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get('set-cookie')).toContain('automaker_session=');

    const corsResponse = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://localhost:4173' },
    });
    expect(corsResponse.headers.get('access-control-allow-origin')).toBe('http://localhost:4173');
    expect(corsResponse.headers.get('access-control-allow-credentials')).toBe('true');

    const oversizedResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'x'.repeat(50 * 1024 * 1024) }),
    });
    expect(oversizedResponse.status).toBe(413);
  });

  it('keeps WebSocket upgrades on the shared Nest HTTP server', async () => {
    const address = runtime.legacy.server.address() as AddressInfo;
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/api/events?apiKey=automaker-test-api-key`
    );
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it('serves migrated edge modules exclusively through Nest', async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), 'nest-edge-contract-'));
    const address = runtime.legacy.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': 'automaker-test-api-key',
    };
    try {
      const models = await fetch(`${baseUrl}/api/models/available`, { headers });
      expect(models.status).toBe(200);
      expect(await models.json()).toMatchObject({ success: true, models: expect.any(Array) });

      const workspace = await fetch(`${baseUrl}/api/workspace/config`, { headers });
      expect(workspace.status).toBe(200);
      expect(await workspace.json()).toMatchObject({ success: true });

      const projects = await fetch(`${baseUrl}/api/projects/overview`, { headers });
      expect(projects.status).toBe(200);
      expect(await projects.json()).toMatchObject({
        success: true,
        projects: expect.any(Array),
        aggregate: expect.any(Object),
      });

      for (const route of [
        'settings/status',
        'settings/global',
        'settings/credentials',
        'settings/model-timeouts',
        'settings/openai-compatible',
      ]) {
        const response = await fetch(`${baseUrl}/api/${route}`, { headers });
        expect(response.status, route).toBe(200);
        expect(await response.json()).toMatchObject({ success: true });
      }

      const projectSettings = await fetch(`${baseUrl}/api/settings/project`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath }),
      });
      expect(projectSettings.status).toBe(200);
      expect(await projectSettings.json()).toMatchObject({ success: true });

      const updatedProjectSettings = await fetch(`${baseUrl}/api/settings/project`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ projectPath, updates: { theme: 'light' } }),
      });
      expect(updatedProjectSettings.status).toBe(200);
      expect(await updatedProjectSettings.json()).toMatchObject({
        success: true,
        settings: { theme: 'light' },
      });

      const invalidSettings = await fetch(`${baseUrl}/api/settings/project`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath, unexpected: true }),
      });
      expect(invalidSettings.status).toBe(400);

      const invalidProvider = await fetch(`${baseUrl}/api/settings/model-timeouts/not-a-provider`, {
        headers,
      });
      expect(invalidProvider.status).toBe(400);

      const environment = await fetch(`${baseUrl}/api/settings/execution-environments/inspect`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath }),
      });
      expect(environment.status).toBe(200);
      expect(await environment.json()).toMatchObject({
        success: true,
        resolved: { type: 'local' },
      });

      const fixtureFile = path.join(projectPath, 'read-fixture.txt');
      await writeFile(fixtureFile, 'fixture');
      for (const [route, body] of [
        ['read', { filePath: fixtureFile }],
        ['readdir', { dirPath: projectPath }],
        ['stat', { filePath: fixtureFile }],
        ['exists', { filePath: fixtureFile }],
      ] as const) {
        const response = await fetch(`${baseUrl}/api/fs/${route}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        expect(response.status, `fs/${route}`).toBe(200);
        expect(await response.json()).toMatchObject({ success: true });
      }

      const writtenFile = path.join(projectPath, 'nested', 'written.txt');
      const writeResponse = await fetch(`${baseUrl}/api/fs/write`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ filePath: writtenFile, content: 'written through Nest' }),
      });
      expect(writeResponse.status).toBe(200);
      await expect(readFile(writtenFile, 'utf8')).resolves.toBe('written through Nest');

      const downloadResponse = await fetch(`${baseUrl}/api/fs/download`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ filePath: writtenFile }),
      });
      expect(downloadResponse.status).toBe(200);
      expect(await downloadResponse.text()).toBe('written through Nest');

      const saveImageResponse = await fetch(`${baseUrl}/api/fs/save-image`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectPath,
          filename: 'fixture.png',
          data: Buffer.from('image-fixture').toString('base64'),
        }),
      });
      expect(saveImageResponse.status).toBe(200);
      const savedImage = (await saveImageResponse.json()) as { path: string };
      const imageResponse = await fetch(
        `${baseUrl}/api/fs/image?path=${encodeURIComponent(savedImage.path)}`,
        { headers }
      );
      expect(imageResponse.status).toBe(200);
      expect(imageResponse.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await imageResponse.arrayBuffer()).toString()).toBe('image-fixture');

      const missingContextFile = await fetch(`${baseUrl}/api/context/describe-file`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ filePath: path.join(projectPath, 'missing-context.md') }),
      });
      expect(missingContextFile.status).toBe(404);
      expect(await missingContextFile.json()).toMatchObject({
        success: false,
        errorCode: 'NOT_FOUND',
      });

      const invalidContextImage = await fetch(`${baseUrl}/api/context/describe-image`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ imagePath: fixtureFile, unexpected: true }),
      });
      expect(invalidContextImage.status).toBe(400);

      const featureList = await fetch(
        `${baseUrl}/api/features/list?projectPath=${encodeURIComponent(projectPath)}`,
        { headers }
      );
      expect(featureList.status).toBe(200);
      expect(await featureList.json()).toMatchObject({ success: true, features: [] });

      const missingFeature = await fetch(`${baseUrl}/api/features/get`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath, featureId: 'missing-feature' }),
      });
      expect(missingFeature.status).toBe(404);
      expect(await missingFeature.json()).toMatchObject({
        success: false,
        errorCode: 'NOT_FOUND',
      });

      const createFeature = await fetch(`${baseUrl}/api/features/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectPath,
          feature: {
            id: 'feature-contract',
            title: 'Contract feature',
            category: 'Tests',
            description: 'Initial description',
            status: 'backlog',
          },
        }),
      });
      expect(createFeature.status).toBe(200);
      expect(await createFeature.json()).toMatchObject({
        success: true,
        feature: { id: 'feature-contract' },
      });

      const updateFeature = await fetch(`${baseUrl}/api/features/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectPath,
          featureId: 'feature-contract',
          updates: { description: 'Updated description', status: 'completed' },
          descriptionHistorySource: 'edit',
        }),
      });
      expect(updateFeature.status).toBe(200);
      expect(await updateFeature.json()).toMatchObject({
        success: true,
        feature: {
          status: 'completed',
          descriptionHistory: [
            { description: 'Initial description', source: 'initial' },
            { description: 'Updated description', source: 'edit' },
          ],
        },
      });

      const invalidFeatureStatus = await fetch(`${baseUrl}/api/features/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectPath,
          featureId: 'feature-contract',
          updates: { status: 'invented-status' },
        }),
      });
      expect(invalidFeatureStatus.status).toBe(400);

      const deleteFeature = await fetch(`${baseUrl}/api/features/delete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath, featureId: 'feature-contract' }),
      });
      expect(deleteFeature.status).toBe(200);
      expect(await deleteFeature.json()).toEqual({ success: true });

      const createSession = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Contract session', projectPath }),
      });
      expect(createSession.status).toBe(200);
      const createdSession = (await createSession.json()) as {
        success: boolean;
        session: { id: string };
      };
      expect(createdSession.success).toBe(true);

      const getSession = await fetch(
        `${baseUrl}/api/sessions/${encodeURIComponent(createdSession.session.id)}`,
        { headers }
      );
      expect(getSession.status).toBe(200);
      expect(await getSession.json()).toMatchObject({
        success: true,
        session: { id: createdSession.session.id },
        messages: [],
      });

      const updateSession = await fetch(
        `${baseUrl}/api/sessions/${encodeURIComponent(createdSession.session.id)}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ name: 'Renamed session', tags: ['contract'] }),
        }
      );
      expect(updateSession.status).toBe(200);
      expect(await updateSession.json()).toMatchObject({
        success: true,
        session: { name: 'Renamed session', tags: ['contract'] },
      });

      const archivedSession = await fetch(
        `${baseUrl}/api/sessions/${encodeURIComponent(createdSession.session.id)}/archive`,
        { method: 'POST', headers, body: '{}' }
      );
      expect(archivedSession.status).toBe(200);

      const sessionList = await fetch(`${baseUrl}/api/sessions?includeArchived=true`, { headers });
      expect(sessionList.status).toBe(200);
      expect(await sessionList.json()).toMatchObject({
        success: true,
        sessions: expect.arrayContaining([
          expect.objectContaining({ id: createdSession.session.id, isArchived: true }),
        ]),
      });

      const deleteSession = await fetch(
        `${baseUrl}/api/sessions/${encodeURIComponent(createdSession.session.id)}`,
        { method: 'DELETE', headers }
      );
      expect(deleteSession.status).toBe(200);
      expect(await deleteSession.json()).toEqual({ success: true });

      const specStatus = await fetch(
        `${baseUrl}/api/spec-regeneration/status?projectPath=${encodeURIComponent(projectPath)}`,
        { headers }
      );
      expect(specStatus.status).toBe(200);
      expect(await specStatus.json()).toMatchObject({
        success: true,
        isRunning: false,
        projectPath,
      });

      const backlogStatus = await fetch(
        `${baseUrl}/api/backlog-plan/status?projectPath=${encodeURIComponent(projectPath)}`,
        { headers }
      );
      expect(backlogStatus.status).toBe(200);
      expect(await backlogStatus.json()).toMatchObject({
        success: true,
        isRunning: false,
        savedPlan: null,
      });

      const applyEmptyPlan = await fetch(`${baseUrl}/api/backlog-plan/apply`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectPath,
          plan: { changes: [], summary: 'Approved empty plan', dependencyUpdates: [] },
        }),
      });
      expect(applyEmptyPlan.status).toBe(200);
      expect(await applyEmptyPlan.json()).toEqual({ success: true, appliedChanges: [] });

      const ideationPrompts = await fetch(`${baseUrl}/api/ideation/prompts`, { headers });
      expect(ideationPrompts.status).toBe(200);
      expect(await ideationPrompts.json()).toMatchObject({
        success: true,
        prompts: expect.any(Array),
        categories: expect.any(Array),
      });

      const createIdea = await fetch(`${baseUrl}/api/ideation/ideas/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectPath,
          idea: {
            title: 'Contract idea',
            description: 'Persisted through Nest',
            category: 'feature',
          },
        }),
      });
      expect(createIdea.status).toBe(200);
      const createdIdea = (await createIdea.json()) as {
        success: boolean;
        idea: { id: string };
      };
      expect(createdIdea.success).toBe(true);

      const updateIdea = await fetch(`${baseUrl}/api/ideation/ideas/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectPath,
          ideaId: createdIdea.idea.id,
          updates: { status: 'ready' },
        }),
      });
      expect(updateIdea.status).toBe(200);
      expect(await updateIdea.json()).toMatchObject({
        success: true,
        idea: { id: createdIdea.idea.id, status: 'ready' },
      });

      const listIdeas = await fetch(`${baseUrl}/api/ideation/ideas/list`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath }),
      });
      expect(listIdeas.status).toBe(200);
      expect(await listIdeas.json()).toMatchObject({
        success: true,
        ideas: [expect.objectContaining({ id: createdIdea.idea.id })],
      });

      const invalidIdea = await fetch(`${baseUrl}/api/ideation/ideas/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectPath,
          idea: { title: 'Invalid', description: 'Invalid', category: 'unknown' },
        }),
      });
      expect(invalidIdea.status).toBe(400);

      const deleteIdea = await fetch(`${baseUrl}/api/ideation/ideas/delete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath, ideaId: createdIdea.idea.id }),
      });
      expect(deleteIdea.status).toBe(200);
      expect(await deleteIdea.json()).toEqual({ success: true });

      await execFileAsync('git', ['init'], { cwd: projectPath });
      await execFileAsync('git', ['config', 'user.name', 'Contract Test'], { cwd: projectPath });
      await execFileAsync('git', ['config', 'user.email', 'contract@example.test'], {
        cwd: projectPath,
      });
      const trackedFile = path.join(projectPath, 'tracked.txt');
      await writeFile(trackedFile, 'initial\n');
      await execFileAsync('git', ['add', '--', 'tracked.txt'], { cwd: projectPath });
      await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: projectPath });
      await writeFile(trackedFile, 'changed\n');

      const gitDiffs = await fetch(`${baseUrl}/api/git/diffs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath }),
      });
      expect(gitDiffs.status).toBe(200);
      expect(await gitDiffs.json()).toMatchObject({
        success: true,
        hasChanges: true,
        executionEnvironment: { type: 'local', projectPath },
      });

      const gitDetails = await fetch(`${baseUrl}/api/git/details`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath, filePath: 'tracked.txt' }),
      });
      expect(gitDetails.status).toBe(200);
      expect(await gitDetails.json()).toMatchObject({
        success: true,
        details: { isUnstaged: true },
      });

      const stageFile = await fetch(`${baseUrl}/api/git/stage-files`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath, files: ['tracked.txt'], operation: 'stage' }),
      });
      expect(stageFile.status).toBe(200);
      expect(await stageFile.json()).toMatchObject({
        success: true,
        result: { operation: 'stage', filesCount: 1 },
      });

      const worktreeList = await fetch(`${baseUrl}/api/worktree/list`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath }),
      });
      expect(worktreeList.status).toBe(200);
      const listedWorktrees = (await worktreeList.json()) as {
        success: boolean;
        worktrees: Array<Record<string, unknown>>;
      };
      expect(listedWorktrees.success).toBe(true);
      expect(listedWorktrees.worktrees).toContainEqual(
        expect.objectContaining({
          path: projectPath,
          isMain: true,
          executionEnvironment: expect.objectContaining({ type: 'local', projectPath }),
        })
      );

      const worktreeChanges = await fetch(`${baseUrl}/api/worktree/check-changes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ worktreePath: projectPath }),
      });
      expect(worktreeChanges.status).toBe(200);
      const changedWorktree = (await worktreeChanges.json()) as {
        success: boolean;
        result: { hasChanges: boolean; staged: string[]; totalFiles: number };
        executionEnvironment: { type: string; projectPath: string };
      };
      expect(changedWorktree).toMatchObject({
        success: true,
        result: { hasChanges: true, staged: ['tracked.txt'] },
        executionEnvironment: { type: 'local', projectPath },
      });
      expect(changedWorktree.result.totalFiles).toBeGreaterThanOrEqual(1);

      const worktreeBranches = await fetch(`${baseUrl}/api/worktree/list-branches`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ worktreePath: projectPath, includeRemote: false }),
      });
      expect(worktreeBranches.status).toBe(200);
      expect(await worktreeBranches.json()).toMatchObject({
        success: true,
        result: {
          currentBranch: expect.any(String),
          branches: [expect.objectContaining({ isCurrent: true, isRemote: false })],
        },
      });

      const worktreeLog = await fetch(`${baseUrl}/api/worktree/commit-log`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ worktreePath: projectPath, limit: 1 }),
      });
      expect(worktreeLog.status).toBe(200);
      expect(await worktreeLog.json()).toMatchObject({
        success: true,
        result: {
          total: 1,
          commits: [expect.objectContaining({ subject: 'initial', files: ['tracked.txt'] })],
        },
      });

      const unstageWorktreeFile = await fetch(`${baseUrl}/api/worktree/stage-files`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          worktreePath: projectPath,
          files: ['tracked.txt'],
          operation: 'unstage',
        }),
      });
      expect(unstageWorktreeFile.status).toBe(200);
      expect(await unstageWorktreeFile.json()).toMatchObject({
        success: true,
        result: { operation: 'unstage', filesCount: 1 },
      });

      const commitWorktree = await fetch(`${baseUrl}/api/worktree/commit`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ worktreePath: projectPath, message: 'worktree Nest commit' }),
      });
      expect(commitWorktree.status).toBe(200);
      expect(await commitWorktree.json()).toMatchObject({
        success: true,
        result: {
          committed: true,
          branch: expect.any(String),
          message: 'worktree Nest commit',
        },
        executionEnvironment: { type: 'local', projectPath },
      });

      for (const route of ['notifications/list', 'event-history/list']) {
        const response = await fetch(`${baseUrl}/api/${route}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ projectPath }),
        });
        expect(response.status, route).toBe(200);
        expect(await response.json()).toMatchObject({ success: true });
      }

      const strictRequest = await fetch(`${baseUrl}/api/notifications/list`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath, unexpected: true }),
      });
      expect(strictRequest.status).toBe(400);

      const invalidTemplate = await fetch(`${baseUrl}/api/templates/clone`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          repoUrl: 'https://example.com/x',
          projectName: 'x',
          parentDir: projectPath,
        }),
      });
      expect(invalidTemplate.status).toBe(400);
    } finally {
      await rm(projectPath, { recursive: true });
    }
  });

  it('preserves authentication for every protected endpoint through Nest', async () => {
    const inventoryPath = path.resolve(
      import.meta.dirname,
      '../../../../docs/backend-nestjs-migration/artifacts/http-routes.json'
    );
    const inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) as {
      endpoints: Array<{ access: string; method: string; path: string }>;
    };
    const address = runtime.legacy.server.address() as AddressInfo;

    for (const endpoint of inventory.endpoints.filter(({ access }) => access === 'protected')) {
      const requestPath = endpoint.path
        .replace(/:[^/]+/g, 'contract-fixture')
        .replace(/\*/g, 'contract-fixture');
      const response = await fetch(`http://127.0.0.1:${address.port}${requestPath}`, {
        method: endpoint.method,
        headers: { 'Content-Type': 'application/json' },
        body: ['GET', 'HEAD'].includes(endpoint.method) ? undefined : '{}',
      });

      expect(response.status, `${endpoint.method} ${endpoint.path}`).toBe(401);
    }
  });

  it('cleans up a partially initialized Nest application when a blocking task fails', async () => {
    const initialize = vi.fn().mockRejectedValue(new Error('startup fixture failed'));

    await expect(
      createNestApplication({
        host: '127.0.0.1',
        port: 0,
        runStartupTasks: true,
        enableShutdownHooks: false,
        services: { agentService: { initialize } as never },
      })
    ).rejects.toThrow('startup fixture failed');
    expect(initialize).toHaveBeenCalledOnce();
  });
});
