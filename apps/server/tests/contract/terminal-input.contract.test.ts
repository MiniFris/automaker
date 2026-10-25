import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { TerminalService } from '../../src/services/terminal-service.js';

let runtime: Awaited<ReturnType<typeof createNestApplication>>;
let directory: string;
let base: string;

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-terminal-input-'));
  runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: directory,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${(runtime.app.getHttpServer().address() as AddressInfo).port}/api/terminal`;
});

afterAll(async () => {
  await runtime?.app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function request(route: string, body: unknown, method = 'POST') {
  const response = await fetch(`${base}/${route}`, {
    method,
    headers: { 'x-api-key': 'fixture', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

it('rejects invalid native HTTP inputs with the same errors before any PTY or limit mutation', async () => {
  const terminal = runtime.app.get(TerminalService);
  const create = vi.spyOn(terminal, 'createSession');
  const resize = vi.spyOn(terminal, 'resize');
  const limits = vi.spyOn(terminal, 'setMaxSessions');
  for (const body of [
    { cols: 0 },
    { cols: 1001 },
    { cols: 1.5 },
    { rows: 501 },
    { rows: '24' },
    { shell: 4 },
    { environmentTargetId: null },
  ]) {
    expect(await request('sessions', body)).toEqual({
      status: 400,
      body: { success: false, error: 'Invalid terminal options' },
    });
  }
  for (const body of [
    {},
    { cols: 80 },
    { cols: '80', rows: 24 },
    { cols: 1001, rows: 24 },
    { cols: 80, rows: 0 },
    [],
  ]) {
    expect(await request('sessions/opaque-id/resize', body)).toEqual({
      status: 400,
      body: { success: false, error: 'cols (1–1000) and rows (1–500) must be integers' },
    });
  }
  for (const maxSessions of [0, 1001, 1.5, '10', null]) {
    expect(await request('settings', { maxSessions }, 'PUT')).toEqual({
      status: 400,
      body: { success: false, error: 'maxSessions must be an integer between 1 and 1000' },
    });
  }
  expect(create).not.toHaveBeenCalled();
  expect(resize).not.toHaveBeenCalled();
  expect(limits).not.toHaveBeenCalled();
});

it('retains defaults, ignored fields, array no-op inputs, accepted boundaries and missing session status', async () => {
  const terminal = runtime.app.get(TerminalService);
  const create = vi.spyOn(terminal, 'createSession').mockResolvedValue({
    id: 'fixture',
    cwd: directory,
    shell: '/bin/sh',
    createdAt: new Date(1),
  } as never);
  const resize = vi.spyOn(terminal, 'resize').mockReturnValue(false);
  const limits = vi.spyOn(terminal, 'setMaxSessions');
  for (const body of [{ ignored: 'kept-compatible' }, []]) {
    expect(await request('sessions', body)).toMatchObject({
      status: 200,
      body: { success: true, data: { id: 'fixture' } },
    });
    expect(create).toHaveBeenLastCalledWith({
      cwd: undefined,
      cols: 80,
      rows: 24,
      shell: undefined,
      environmentTargetId: undefined,
    });
  }
  expect(
    await request('sessions', {
      cols: 1000,
      rows: 500,
      shell: '',
      environmentTargetId: '',
      ignored: true,
    })
  ).toMatchObject({ status: 200 });
  expect(create).toHaveBeenLastCalledWith({
    cwd: undefined,
    cols: 1000,
    rows: 500,
    shell: '',
    environmentTargetId: '',
  });
  expect(await request('sessions/opaque-id/resize', { cols: 1, rows: 500, ignored: true })).toEqual(
    { status: 404, body: { success: false, error: 'Session not found' } }
  );
  expect(resize).toHaveBeenCalledWith('opaque-id', 1, 500);
  expect(await request('sessions/opaque%20%3A%20id', undefined, 'GET')).toEqual({
    status: 404,
    body: {
      success: false,
      error: 'Terminal session ended; create a new terminal explicitly.',
    },
  });
  expect(await request('sessions/opaque%20%3A%20id', undefined, 'DELETE')).toEqual({
    status: 404,
    body: { success: false, error: 'Session not found' },
  });
  for (const body of [{ ignored: true }, []])
    expect(await request('settings', body, 'PUT')).toMatchObject({
      status: 200,
      body: { success: true },
    });
  expect(limits).not.toHaveBeenCalled();
  expect(await request('settings', { maxSessions: 1000, ignored: true }, 'PUT')).toMatchObject({
    status: 200,
    body: { data: { maxSessions: 1000 } },
  });
  expect(limits).toHaveBeenCalledWith(1000);
});
