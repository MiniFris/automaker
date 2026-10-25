import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AgentService } from '../../src/services/agent-service.js';
import { AgentSessionRepository } from '../../src/services/agent/agent-session.repository.js';
import { AgentApplicationService } from '../../src/modules/agents/agent-application.service.js';
import { MockProvider } from '../helpers/mock-provider.js';
import {
  AgentStartResponseSchema,
  AgentSendResponseSchema,
  AgentHistoryResponseSchema,
  AgentMutationResponseSchema,
  AgentClearResponseSchema,
  AgentModelResponseSchema,
  AgentQueueAddResponseSchema,
  AgentQueueListResponseSchema,
} from '@automaker/contracts/domains/agent';

let runtime: Awaited<ReturnType<typeof createNestApplication>>;
let root: string, project: string, base: string;
let provider: MockProvider;
const sessionId = 'agent-response-fixture';
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-response-'));
  project = path.join(root, 'project');
  await fs.mkdir(project);
  provider = new MockProvider('claude');
  runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: project,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [{ name: 'claude', create: () => provider }],
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      ALLOWED_ROOT_DIRECTORY: root,
      AUTOMAKER_API_KEY: 'agent-response-fixture',
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/agent/`;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await runtime?.app.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});
async function call(route: string, body: unknown) {
  const response = await fetch(base + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'agent-response-fixture' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}

it('validates all ten native operations with stored rich history/queue and no provider execution', async () => {
  const repository = runtime.app.get(AgentSessionRepository);
  await repository.saveMetadata({
    [sessionId]: {
      id: sessionId,
      name: 'Fixture',
      workingDirectory: project,
      createdAt: 'legacy timestamp',
      updatedAt: 'legacy timestamp',
    },
  });
  const message = {
    id: 'message',
    role: 'assistant',
    content: '# Rich history\n\n中文 🙂',
    timestamp: 'legacy timestamp',
    images: [
      { data: 'YQ==', mimeType: 'image/png', filename: 'image.png', extraImage: { kept: true } },
    ],
    isError: null,
    deliveryId: null,
    executionStatus: 'historical_extension_status',
    extraMessage: { kept: true },
  };
  await repository.saveMessages(sessionId, [message] as never);
  const queued = {
    id: 'queued-history',
    message: 'Historical queued prompt',
    addedAt: 'legacy timestamp',
    model: null,
    imagePaths: null,
    thinkingLevel: null,
    deliveryStatus: 'interrupted',
    extraQueue: { kept: true },
  };
  await repository.saveQueue(sessionId, [queued] as never);
  const execution = vi.spyOn(provider, 'executeQuery');
  const started = await call('start', { sessionId, workingDirectory: project });
  expect(started.status).toBe(200);
  expect(AgentStartResponseSchema.parse(started.body)).toMatchObject({
    sessionId,
    messages: [message],
  });
  const history = await call('history', { sessionId });
  expect(history.status).toBe(200);
  expect(AgentHistoryResponseSchema.parse(history.body)).toMatchObject({
    success: true,
    isRunning: false,
    messages: [message],
  });
  expect(
    AgentQueueListResponseSchema.parse((await call('queue/list', { sessionId })).body)
  ).toMatchObject({ queue: [queued] });
  const adding = await call('queue/add', {
    sessionId,
    message: 'New queued fixture',
    model: 'claude-sonnet',
  });
  expect(adding.status).toBe(200);
  const added = AgentQueueAddResponseSchema.parse(adding.body);
  expect(added.success).toBe(true);
  if (!added.success) throw new Error('Expected a queued prompt');
  expect(added.queuedPrompt.message).toBe('New queued fixture');
  expect(
    AgentMutationResponseSchema.parse(
      (await call('queue/remove', { sessionId, promptId: added.queuedPrompt.id })).body
    )
  ).toEqual({ success: true });
  expect(
    AgentMutationResponseSchema.parse((await call('queue/clear', { sessionId })).body)
  ).toEqual({ success: true });
  expect(
    AgentModelResponseSchema.parse(
      (await call('model', { sessionId, model: 'claude-sonnet' })).body
    )
  ).toEqual({ success: true });
  expect(AgentMutationResponseSchema.parse((await call('stop', { sessionId })).body)).toEqual({
    success: true,
  });
  // send is an acknowledgement of background dispatch. Keep that dispatch explicitly offline.
  const send = vi
    .spyOn(runtime.app.get(AgentService), 'sendMessage')
    .mockResolvedValue({ success: true } as never);
  expect(
    AgentSendResponseSchema.parse(
      (await call('send', { sessionId, message: 'Offline dispatch fixture' })).body
    )
  ).toEqual({ success: true, message: 'Message sent' });
  expect(send).toHaveBeenCalledOnce();
  expect(AgentClearResponseSchema.parse((await call('clear', { sessionId })).body)).toEqual({
    success: true,
  });
  expect(execution).not.toHaveBeenCalled();
});

const errors = [
  ['history', {}],
  ['stop', {}],
  ['queue/add', { message: 'Missing session' }],
  ['queue/list', {}],
  ['queue/remove', { promptId: 'missing' }],
  ['queue/clear', {}],
] as const;
it.each(errors)('preserves HTTP200 operation failure payload for %s', async (route, extra) => {
  const response = await call(route, { sessionId: 'missing-session', ...extra });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ success: false, error: 'Session not found' });
});
it('preserves the model false-without-error and clear-missing success variants', async () => {
  expect(
    (await call('model', { sessionId: 'missing-model', model: 'claude-sonnet' })).body
  ).toEqual({ success: false });
  expect((await call('clear', { sessionId: 'missing-clear' })).body).toEqual({ success: true });
});

const malformed = [
  [
    'start',
    'start',
    { workingDirectory: 'fixture' },
    { success: true, sessionId: 'fixture', messages: [{ id: 42 }] },
  ],
  ['send', 'send', { message: 'Fixture' }, { success: true, message: 42 }],
  ['history', 'history', {}, { success: true, messages: [], isRunning: 'wrong' }],
  ['stop', 'stop', {}, { success: false, error: 42 }],
  ['clear', 'clear', {}, { success: 'wrong' }],
  ['model', 'model', { model: 'fixture' }, { success: 'wrong' }],
  ['queue/add', 'queueAdd', { message: 'Fixture' }, { success: true, queuedPrompt: { id: 42 } }],
  ['queue/list', 'queueList', {}, { success: true, queue: [{}] }],
  ['queue/remove', 'queueRemove', { promptId: 'fixture' }, { success: false, error: 42 }],
  ['queue/clear', 'queueClear', {}, { success: 'wrong' }],
] as const;
it.each(malformed)(
  'rejects malformed application output at native HTTP %s',
  async (route, method, extra, output) => {
    const service = runtime.app.get(AgentApplicationService);
    const spy = vi.spyOn(service as any, method);
    const result = { ...output, privateFixture: 'must-not-leak' };
    if (method === 'send') spy.mockReturnValue(result);
    else spy.mockResolvedValue(result);
    const response = await call(route, {
      sessionId: 'fixture',
      ...extra,
      ...(method === 'start' ? { workingDirectory: project } : {}),
    });
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, error: 'Internal server error.' });
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
  }
);

it('preserves denied and invalid request behavior before dispatch', async () => {
  const send = vi.spyOn(runtime.app.get(AgentApplicationService), 'send');
  expect(
    (await call('send', { sessionId, message: 'Fixture', workingDirectory: path.dirname(root) }))
      .status
  ).toBe(403);
  expect((await call('send', { sessionId, message: 42 })).status).toBe(400);
  expect(send).not.toHaveBeenCalled();
});
