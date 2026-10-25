import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { SharedHttpServerExpressAdapter } from '../../../src/core/http/shared-http-server.adapter.js';

afterEach(() => vi.useRealTimers());

it('rejects new HTTP requests from prepareClose and confirms an idle server drain', async () => {
  const application = express();
  const server = createServer(application);
  const adapter = new SharedHttpServerExpressAdapter(application, server);
  const work = vi.fn((_request, response) => response.json({ success: true }));
  application.get('/work', work);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  adapter.beforeClose();
  const response = await fetch(`http://127.0.0.1:${port}/work`);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ errorCode: 'UNAVAILABLE' });
  expect(work).not.toHaveBeenCalled();
  const closing = adapter.close();
  expect(adapter.close()).toBe(closing);
  await closing;
  expect(() => adapter.assertCleanupConfirmed()).not.toThrow();
});

it('force-closes only its owned held HTTP connection after grace without claiming its domain work was canceled', async () => {
  const application = express(),
    server = createServer(application);
  const adapter = new SharedHttpServerExpressAdapter(application, server);
  const independent = createServer((_request, response) => response.end('independent'));
  await new Promise<void>((done) => independent.listen(0, '127.0.0.1', done));
  let entered!: () => void;
  const active = new Promise<void>((done) => {
    entered = done;
  });
  let domainSettled = false;
  let release!: () => void;
  const domainWork = new Promise<void>((done) => {
    release = done;
  });
  application.get('/held', async (_request, response) => {
    entered();
    await domainWork;
    domainSettled = true;
    if (!response.destroyed) response.end('finished');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const request = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/held`).catch(
    (error) => error
  );
  await active;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const closing = adapter.close();
  await vi.advanceTimersByTimeAsync(5000);
  vi.useRealTimers();
  await closing;
  expect(await request).toBeInstanceOf(Error);
  expect(domainSettled).toBe(false);
  expect(() => adapter.assertCleanupConfirmed()).not.toThrow();
  try {
    expect(
      await (await fetch(`http://127.0.0.1:${(independent.address() as AddressInfo).port}/`)).text()
    ).toBe('independent');
  } finally {
    release();
    await domainWork;
    await new Promise<void>((done) => independent.close(() => done()));
  }
});

it('bounds an unconfirmed close and never clears failure after a late callback', async () => {
  const server = new EventEmitter() as Server;
  let late!: () => void;
  server.close = vi.fn((callback) => {
    late = callback as () => void;
    return server;
  });
  const adapter = new SharedHttpServerExpressAdapter(express(), server);
  vi.useFakeTimers();
  const closing = adapter.close();
  await vi.advanceTimersByTimeAsync(6000);
  await closing;
  expect(() => adapter.assertCleanupConfirmed()).toThrow(
    expect.objectContaining({ code: 'HTTP_SERVER_CLEANUP_FAILED' })
  );
  late();
  expect(adapter.close()).toBe(closing);
  expect(() => adapter.assertCleanupConfirmed()).toThrow('could not be confirmed');
  expect(vi.getTimerCount()).toBe(0);
});

it('confirms a server which never started listening', async () => {
  const application = express();
  const adapter = new SharedHttpServerExpressAdapter(application, createServer(application));
  await adapter.close();
  expect(() => adapter.assertCleanupConfirmed()).not.toThrow();
});
