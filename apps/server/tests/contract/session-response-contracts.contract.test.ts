import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  SessionCreateResponseSchema,
  SessionListResponseSchema,
  SessionReadResponseSchema,
  SessionMetadataEnvelopeSchema,
  SessionMutationResponseSchema,
  ProjectsOverviewResponseSchema,
} from '@automaker/contracts';
import { createNestApplication } from '../../src/main.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import { AgentSessionRepository } from '../../src/services/agent/agent-session.repository.js';

it('validates all session response routes and full project overview without dropping stored extension fields', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automaker-session-contracts-'));
  const project = path.join(root, 'project');
  await mkdir(project);
  let runtime: Awaited<ReturnType<typeof createNestApplication>> | undefined;
  try {
    runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: project,
      dataDir: path.join(root, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      providerRegistrations: [],
      environment: {
        NODE_ENV: 'test',
        HOME: root,
        USERPROFILE: root,
        XDG_CONFIG_HOME: path.join(root, 'config'),
        ALLOWED_ROOT_DIRECTORY: root,
        AUTOMAKER_API_KEY: 'session-contract-fixture',
      },
    });
    await runtime.start();
    const base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api`;
    async function call(route: string, method = 'GET', body?: unknown) {
      const response = await fetch(base + route, {
        method,
        headers: { 'X-API-Key': 'session-contract-fixture', 'Content-Type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    }
    const created = await call('/sessions', 'POST', {
      name: 'Owned session',
      projectPath: project,
    });
    expect(created.status).toBe(200);
    const session = SessionCreateResponseSchema.parse(created.body).session;
    const repository = runtime.app.get(AgentSessionRepository);
    await repository.saveMetadata({
      ...(await repository.loadMetadata()),
      legacy: { id: 'legacy' },
    } as never);
    expect(SessionReadResponseSchema.parse((await call('/sessions/legacy')).body).session).toEqual({
      id: 'legacy',
    });
    await repository.updateMetadata(session.id, {
      extraMetadata: { preserved: true },
      executionEnvironment: {
        version: 1,
        id: 'binding-fixture',
        type: 'local',
        projectPath: project,
        cwd: project,
        createdAt: 'legacy timestamp',
        serverIdentity: 'fixture-server',
        selection: { mode: 'local' },
        source: 'project',
        extraBinding: { preserved: true },
      },
    } as never);
    await repository.saveMessages(session.id, [
      {
        id: 'message',
        role: 'assistant',
        content: 'Owned preview',
        timestamp: 'legacy timestamp',
        runId: 'run-fixture',
        executionStatus: 'interrupted',
        extraMessage: { preserved: true },
      } as never,
    ]);
    const listed = SessionListResponseSchema.parse((await call('/sessions')).body);
    expect(listed.sessions).toContainEqual(
      expect.objectContaining({
        id: session.id,
        messageCount: 1,
        preview: 'Owned preview',
        isArchived: false,
      })
    );
    const read = SessionReadResponseSchema.parse((await call(`/sessions/${session.id}`)).body);
    expect(read.session.extraMetadata).toEqual({ preserved: true });
    expect(read.session.executionEnvironment?.extraBinding).toEqual({ preserved: true });
    expect(read.messages[0].extraMessage).toEqual({ preserved: true });
    const changed = await call(`/sessions/${session.id}`, 'PUT', {
      name: 'Renamed',
      tags: ['fixture'],
    });
    expect(changed.status).toBe(200);
    expect(SessionMetadataEnvelopeSchema.parse(changed.body).session).toMatchObject({
      name: 'Renamed',
      tags: ['fixture'],
      extraMetadata: { preserved: true },
    });
    for (const operation of ['archive', 'unarchive']) {
      const changed = await call(`/sessions/${session.id}/${operation}`, 'POST', {});
      expect(changed.status).toBe(200);
      SessionMutationResponseSchema.parse(changed.body);
      const visible = SessionListResponseSchema.parse((await call('/sessions')).body).sessions.some(
        (s) => s.id === session.id
      );
      expect(visible).toBe(operation === 'unarchive');
      if (operation === 'archive')
        expect(
          SessionListResponseSchema.parse(
            (await call('/sessions?includeArchived=true')).body
          ).sessions.some((s) => s.id === session.id)
        ).toBe(true);
    }
    const removed = await call(`/sessions/${session.id}`, 'DELETE');
    expect(removed.status).toBe(200);
    SessionMutationResponseSchema.parse(removed.body);
    expect((await call(`/sessions/${session.id}`)).status).toBe(404);

    await runtime.app.get(SettingsService).updateGlobalSettings({
      projects: [{ id: 'project', name: 'Fixture project', path: project }],
    });
    await runtime.app.get(FeatureLoader).create(project, {
      id: 'overview-feature',
      title: 'Overview fixture',
      description: 'No model',
      status: 'failed',
    });
    const overview = await call('/projects/overview');
    expect(overview.status).toBe(200);
    const parsed = ProjectsOverviewResponseSchema.parse(overview.body);
    expect(parsed.projects[0]).toMatchObject({
      projectId: 'project',
      healthStatus: 'error',
      featureCounts: { failed: 1 },
      totalFeatures: 1,
    });
    expect(parsed.aggregate).toMatchObject({
      projectCounts: { total: 1, withErrors: 1 },
      featureCounts: { total: 1, failed: 1 },
    });
  } finally {
    await runtime?.app.close();
    await rm(root, { recursive: true, force: true });
  }
});
