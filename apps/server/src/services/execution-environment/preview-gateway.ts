import {
  createServer,
  request,
  Agent,
  type IncomingMessage,
  type ServerResponse,
  type OutgoingHttpHeaders,
} from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import {
  PREVIEW_BOOTSTRAP,
  PREVIEW_PORT_FIRST,
  PREVIEW_PORT_LAST,
  previewOrigin,
} from './preview-policy.js';

const policy =
  "sandbox allow-scripts allow-same-origin allow-forms allow-modals allow-downloads; worker-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'";
const blocked = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-session-token',
  'x-terminal-token',
  'clear-site-data',
  'service-worker-allowed',
  'content-security-policy',
  'content-security-policy-report-only',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'trailer',
  'upgrade',
  'proxy-authenticate',
]);
function headers(source: IncomingMessage['headers']): OutgoingHttpHeaders {
  const nominations = new Set(
    String(source.connection ?? '')
      .toLowerCase()
      .split(',')
      .map((x) => x.trim())
  );
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key]) =>
        !blocked.has(key) &&
        !nominations.has(key) &&
        !key.startsWith('x-forwarded-') &&
        !key.startsWith('access-control-') &&
        !key.startsWith('x-automaker-')
    )
  );
}
const bootstrap = `<!doctype html><meta charset="utf-8"><title>Automaker preview</title><p id="status">Authorizing project preview…</p><script>
const key=location.hash.slice(1);history.replaceState(null,'',location.pathname);
fetch('${PREVIEW_BOOTSTRAP}/authorize',{method:'POST',credentials:'same-origin',headers:{'X-Automaker-Preview':key}}).then(r=>{if(!r.ok)throw Error();location.replace('/')}).catch(()=>document.getElementById('status').textContent='Preview authorization expired. Open it again from Automaker.');
</script>`;

/** One authenticated origin/port per process. Root-relative assets and WS need no path rewriting.
 * Never mounted on the Automaker API origin; all target traffic goes through a fixed owned port.
 */
export class PreviewGateway {
  readonly key = randomBytes(32).toString('hex');
  port = 0;
  private readonly sockets = new Set<Socket>();
  private readonly tunnels = new Set<Duplex>();
  private stopped = false;
  private connector?: () => Promise<Duplex>;
  private connections = 0;
  private requests = 0;
  private readonly agent = new Agent({ keepAlive: false, maxSockets: 16 });
  private readonly server = createServer((req, res) => void this.handle(req, res));
  constructor() {
    this.agent.createConnection = (_options, callback) => {
      void this.open().then(
        (socket) => callback?.(null, socket),
        (error) => callback?.(error, undefined!)
      );
      return undefined;
    };
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    this.server.on('upgrade', (req, socket, head) => void this.upgrade(req, socket, head));
    this.server.on('clientError', (_error, socket) => socket.destroy());
    this.server.requestTimeout = 120000;
    this.server.headersTimeout = 15000;
    this.server.maxConnections = 64;
  }

  async listen(port: number) {
    if (port < PREVIEW_PORT_FIRST || port > PREVIEW_PORT_LAST)
      throw new Error('Port is outside the reserved preview range.');
    previewOrigin(port); // reject bad public URL configuration before any command dispatch
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {
        this.server.off('listening', ready);
        reject(error);
      };
      const ready = () => {
        this.server.off('error', failed);
        resolve();
      };
      this.server.once('error', failed);
      this.server.once('listening', ready);
      this.server.listen(
        port,
        process.env.AUTOMAKER_PREVIEW_BIND ??
          (process.env.IS_CONTAINERIZED === 'true' ? '0.0.0.0' : '127.0.0.1')
      );
    });
    this.server.on('error', () => {});
    this.port = port;
  }
  attach(connector: () => Promise<Duplex>) {
    this.connector = connector;
  }
  get url() {
    return `${previewOrigin(this.port)}${PREVIEW_BOOTSTRAP}#${this.key}`;
  }
  private sameOrigin(req: IncomingMessage) {
    try {
      const host = req.headers.host;
      if (!host) return false;
      if (!/^[a-zA-Z0-9.[\]:_-]+$/.test(host)) return false;
      const url = new URL(`http://${host}`);
      if (process.env.AUTOMAKER_PREVIEW_PUBLIC_URL) {
        if (host !== new URL(previewOrigin(this.port)).host) return false;
      } else if (
        Number(url.port) !== this.port ||
        url.username ||
        url.password ||
        url.pathname !== '/'
      )
        return false;
      if (req.headers.origin && new URL(req.headers.origin).host !== host) return false;
      return true;
    } catch {
      return false;
    }
  }
  private equal(value: string) {
    return (
      /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(this.key))
    );
  }
  private authorized(req: IncomingMessage) {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith(`automaker_preview_${this.port}=`));
    return !!cookie && this.equal(cookie.slice(cookie.indexOf('=') + 1));
  }
  private safe(res: ServerResponse, req: IncomingMessage) {
    res.setHeader(
      'Content-Security-Policy',
      policy + `; connect-src 'self' ws://${req.headers.host} wss://${req.headers.host}`
    );
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (!this.sameOrigin(req) || !req.url?.startsWith('/') || req.url.startsWith('//')) {
      res.writeHead(403).end('Invalid preview origin.');
      return;
    }
    this.safe(res, req);
    if (req.url === PREVIEW_BOOTSTRAP && req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(bootstrap);
      return;
    }
    if (req.url === `${PREVIEW_BOOTSTRAP}/authorize` && req.method === 'POST') {
      const token = req.headers['x-automaker-preview'];
      if (typeof token !== 'string' || !this.equal(token)) {
        res.writeHead(401).end('Preview authorization expired.');
        return;
      }
      res.setHeader(
        'Set-Cookie',
        `automaker_preview_${this.port}=${this.key}; HttpOnly; SameSite=Strict; Path=/${previewOrigin(this.port).startsWith('https:') ? '; Secure' : ''}`
      );
      res.writeHead(204).end();
      req.resume();
      return;
    }
    if (req.url.startsWith(PREVIEW_BOOTSTRAP) || !this.authorized(req)) {
      res.writeHead(401).end('Open this preview from Automaker to authorize it.');
      return;
    }
    if (!this.connector || this.stopped || this.requests >= 32) {
      res.writeHead(503).end('Preview is starting, stopped, or busy.');
      return;
    }
    this.requests++;
    res.once('close', () => this.requests--);
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: this.port,
        path: req.url,
        method: req.method,
        headers: headers(req.headers),
        agent: this.agent,
      },
      (response) => {
        const cleaned = headers(response.headers);
        const location = response.headers.location;
        if (location) {
          const origin = `http://${req.headers.host}`;
          let redirect: URL;
          try {
            redirect = new URL(location, origin);
          } catch {
            response.destroy();
            res.writeHead(502).end('Invalid target redirect.');
            return;
          }
          const targetHosts = [
            `127.0.0.1:${this.port + 1000}`,
            `localhost:${this.port + 1000}`,
            `[::1]:${this.port + 1000}`,
          ];
          if (redirect.host !== req.headers.host && !targetHosts.includes(redirect.host)) {
            response.destroy();
            res.writeHead(502).end('External preview redirects are not forwarded.');
            return;
          }
          cleaned.location = redirect.pathname + redirect.search + redirect.hash;
        }
        for (const [key, value] of Object.entries(cleaned))
          if (value !== undefined) res.setHeader(key, value);
        this.safe(res, req);
        res.writeHead(response.statusCode ?? 502);
        response.on('error', () => res.destroy());
        response.pipe(res);
      }
    );
    const timeout = setTimeout(
      () => upstream.destroy(new Error('Preview response timed out.')),
      120000
    );
    upstream.once('close', () => clearTimeout(timeout));
    upstream.on('error', () => {
      if (!res.headersSent)
        res
          .writeHead(502)
          .end(
            'Target preview is not ready or ownership/transport verification failed. No host fallback was used.'
          );
      else res.destroy();
    });
    res.on('close', () => upstream.destroy());
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  }
  private async open() {
    if (this.stopped || !this.connector || this.connections >= 32)
      throw new Error('Preview unavailable.');
    this.connections++;
    let socket: Duplex;
    try {
      socket = await this.connector();
    } catch (error) {
      this.connections--;
      throw error;
    }
    if (this.stopped) {
      this.connections--;
      socket.destroy();
      throw new Error('Preview closed.');
    }
    this.tunnels.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => {
      this.connections--;
      this.tunnels.delete(socket);
    });
    return socket;
  }
  async probe() {
    return new Promise<boolean>((resolve) => {
      const ping = request(
        { hostname: '127.0.0.1', port: this.port, method: 'HEAD', path: '/', agent: this.agent },
        (response) => {
          response.resume();
          resolve(true);
        }
      );
      const timeout = setTimeout(() => ping.destroy(), 3000);
      ping.once('close', () => clearTimeout(timeout));
      ping.on('error', () => resolve(false));
      ping.end();
    });
  }
  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (
      !this.sameOrigin(req) ||
      !this.authorized(req) ||
      req.headers.upgrade?.toLowerCase() !== 'websocket' ||
      !req.url?.startsWith('/') ||
      req.url.startsWith('//')
    ) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    try {
      const cleaned = { ...headers(req.headers), connection: 'Upgrade', upgrade: 'websocket' };
      // Handle the HTTP upgrade response ourselves so target Set-Cookie/CSP cannot escape filtering.
      const upstream = request({
        hostname: '127.0.0.1',
        port: this.port,
        path: req.url,
        headers: cleaned,
        agent: this.agent,
      });
      upstream.on('upgrade', (response, remote, remoteHead) => {
        const responseHeaders = {
          ...headers(response.headers),
          connection: 'Upgrade',
          upgrade: 'websocket',
        };
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
            Object.entries(responseHeaders)
              .map(([key, value]) => `${key}: ${value}`)
              .join('\r\n') +
            '\r\n\r\n'
        );
        if (remoteHead.length) socket.write(remoteHead);
        if (head.length) remote.write(head);
        remote.pipe(socket);
        socket.pipe(remote);
        socket.on('close', () => remote.destroy());
        remote.on('close', () => socket.destroy());
        remote.on('error', () => socket.destroy());
      });
      upstream.on('response', (response) => {
        response.destroy();
        socket.destroy();
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
      upstream.end();
    } catch {
      socket.destroy();
    }
  }
  async close() {
    this.stopped = true;
    this.agent.destroy();
    for (const socket of this.tunnels) socket.destroy();
    for (const socket of this.sockets) socket.destroy();
    if (this.server.listening)
      await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
