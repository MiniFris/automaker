import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { PreviewGateway } from '@/services/execution-environment/preview-gateway.js';
import { PREVIEW_BOOTSTRAP } from '@/services/execution-environment/preview-policy.js';

let target: Server, gateway: PreviewGateway, origin: string, cookie: string;
let targetHeaders: Record<string, unknown>;
const peers: WebSocket[] = [];
const fetch = (url: string, options: RequestInit = {}) =>
  globalThis.fetch(url, { ...options, headers: { ...options.headers, Connection: 'close' } });
beforeEach(async () => {
  targetHeaders = {};
  target = createServer((req, res) => {
    targetHeaders = req.headers;
    if (req.url?.startsWith('/redirect')) {
      res.setHeader(
        'Location',
        req.url === '/redirect-target'
          ? `http://127.0.0.1:${gateway.port + 1000}/asset.bin`
          : req.url === '/redirect-invalid'
            ? 'http://['
            : 'https://external.example.test/'
      );
      res.writeHead(302).end();
      return;
    }
    res.setHeader('Set-Cookie', 'automaker_session=POISON; HttpOnly; Path=/');
    res.setHeader('Clear-Site-Data', '"cookies"');
    res.setHeader('Content-Security-Policy', 'default-src *');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.end(Buffer.from([0, 255, 1, 128, 7]));
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  gateway = new PreviewGateway();
  for (let port = 3100; port <= 3119; port++) {
    try {
      await gateway.listen(port);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  gateway.attach(async () => connect((target.address() as { port: number }).port, '127.0.0.1'));
  origin = `http://127.0.0.1:${gateway.port}`;
  cookie = `automaker_preview_${gateway.port}=${gateway.key}`;
});
afterEach(async () => {
  for (const peer of peers.splice(0)) peer.terminate();
  await gateway.close();
  target.closeAllConnections();
  await new Promise<void>((resolve) => target.close(() => resolve()));
  vi.unstubAllEnvs();
});
it('authorizes through a fragment bootstrap and never accepts anonymous target requests', async () => {
  expect((await fetch(origin + '/')).status).toBe(401);
  const bootstrap = await fetch(origin + PREVIEW_BOOTSTRAP);
  expect(bootstrap.status).toBe(200);
  expect(await bootstrap.text()).not.toContain(gateway.key);
  expect(
    (
      await fetch(origin + PREVIEW_BOOTSTRAP + '/authorize', {
        method: 'POST',
        headers: { 'X-Automaker-Preview': 'é'.repeat(64) },
      })
    ).status
  ).toBe(401);
  const auth = await fetch(origin + PREVIEW_BOOTSTRAP + '/authorize', {
    method: 'POST',
    headers: { 'X-Automaker-Preview': gateway.key, Origin: origin },
  });
  expect(auth.status).toBe(204);
  expect(auth.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
  expect(
    (await fetch(origin + '/', { headers: { Cookie: cookie, Origin: 'http://localhost:3007' } }))
      .status
  ).toBe(403);
});
it('streams binary responses while stripping controller credentials and target cookie/CSP injection', async () => {
  const response = await fetch(origin + '/asset.bin', {
    headers: {
      Cookie: cookie + '; automaker_session=SECRET',
      Authorization: 'Bearer SECRET',
      'X-API-Key': 'SECRET',
      'X-Session-Token': 'SECRET',
      'X-Terminal-Token': 'SECRET',
      'X-Forwarded-Authorization': 'SECRET',
    },
  });
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0, 255, 1, 128, 7]));
  expect(JSON.stringify(targetHeaders)).not.toContain('SECRET');
  expect(targetHeaders).not.toHaveProperty('cookie');
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('clear-site-data')).toBeNull();
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(response.headers.get('content-security-policy')).toContain("worker-src 'none'");
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  const redirect = await fetch(origin + '/redirect-target', {
    redirect: 'manual',
    headers: { Cookie: cookie },
  });
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get('location')).toBe('/asset.bin');
  for (const route of ['/redirect-invalid', '/redirect-external'])
    expect(
      (await fetch(origin + route, { redirect: 'manual', headers: { Cookie: cookie } })).status
    ).toBe(502);
});
it('proxies authenticated binary WebSockets without forwarding cookies or accepting cross-origin upgrades', async () => {
  const wss = new WebSocketServer({ noServer: true });
  target.on('upgrade', (req, socket, head) => {
    targetHeaders = req.headers;
    wss.handleUpgrade(req, socket, head, (ws) => {
      peers.push(ws);
      ws.on('message', (data) => ws.send(data));
    });
  });
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/hmr', {
    headers: {
      Cookie: cookie + '; automaker_session=SECRET',
      Origin: origin,
      'X-API-Key': 'SECRET',
    },
  });
  peers.push(ws);
  await once(ws, 'open');
  const received = once(ws, 'message');
  ws.send(Buffer.from([0, 255, 128]));
  expect(Buffer.from((await received)[0])).toEqual(Buffer.from([0, 255, 128]));
  expect(JSON.stringify(targetHeaders)).not.toContain('SECRET');
  const rejected = new WebSocket(origin.replace('http:', 'ws:') + '/hmr', {
    headers: { Cookie: cookie, Origin: 'http://localhost:3007' },
  });
  peers.push(rejected);
  await once(rejected, 'error');
  await gateway.close();
  await vi.waitFor(() => expect(ws.readyState).toBe(WebSocket.CLOSED));
  wss.close();
});
it('revokes old capabilities when the same listener port is reused', async () => {
  const port = gateway.port;
  await gateway.close();
  gateway = new PreviewGateway();
  await gateway.listen(port);
  expect((await fetch(origin + '/', { headers: { Cookie: cookie } })).status).toBe(401);
});
