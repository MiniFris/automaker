import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { ClaudeUsageService } from '../../src/services/claude-usage-service.js';
import { GeminiUsageService } from '../../src/services/gemini-usage-service.js';
import { ZaiUsageService } from '../../src/services/zai-usage-service.js';
import { ApplicationCredentialsService } from '../../src/modules/providers/application-credentials.service.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

it('isolates native usage environments, paths and actual z.ai requests across two applications', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-usage-env-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const received: { path: string | undefined; knownAuthorization: boolean }[] = [];
  const expectedAuthorization = [
    'Bearer offline-zai-one',
    'Bearer offline-zai-two',
    'Bearer explicit-offline-verification',
  ];
  const server = createServer((request, response) => {
    received.push({
      path: request.url,
      knownAuthorization: request.headers.authorization === expectedAuthorization[received.length],
    });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ success: true, data: { limits: [] } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const allowedOrigins = new Set([origin]);
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (!allowedOrigins.has(url.origin))
      throw new Error('Unexpected network request in usage fixture.');
    return originalFetch(input, init);
  });
  try {
    for (const name of ['one', 'two']) {
      const root = path.join(directory, name);
      await mkdir(path.join(root, '.gemini'), { recursive: true });
      if (name === 'one') {
        await writeFile(
          path.join(root, '.gemini', 'oauth_creds.json'),
          JSON.stringify({ access_token: 'offline-google-one' })
        );
      }
      const runtime = await createNestApplication({
        host: '127.0.0.1',
        port: 0,
        workingDirectory: root,
        dataDir: path.join(root, 'data'),
        runStartupTasks: false,
        enableShutdownHooks: false,
        environment: {
          NODE_ENV: 'test',
          HOME: root,
          AUTOMAKER_API_KEY: 'offline-fixture',
          Z_AI_API_KEY: `offline-zai-${name}`,
          Z_AI_API_HOST: `${origin}/${name}`,
          Z_AI_QUOTA_URL: `${origin}/${name}/quota`,
          ENABLE_REQUEST_LOGGING: 'false',
        },
      });
      apps.push(runtime);
      await runtime.start();
      allowedOrigins.add(`http://127.0.0.1:${runtime.app.getHttpServer().address().port}`);
    }
    const [first, second] = apps;
    const firstZai = first.app.get(ZaiUsageService);
    const secondZai = second.app.get(ZaiUsageService);
    expect(firstZai.getApiToken() === 'offline-zai-one').toBe(true);
    expect(secondZai.getApiToken() === 'offline-zai-two').toBe(true);
    expect(firstZai.getApiHost()).toBe(`${origin}/one`);
    expect(secondZai.getApiHost()).toBe(`${origin}/two`);
    expect(await first.app.get(GeminiUsageService).isAvailable()).toBe(true);
    expect(await second.app.get(GeminiUsageService).isAvailable()).toBe(false);
    // No Google request is made when this application's own CLI credentials are missing.
    expect(await second.app.get(GeminiUsageService).fetchUsageData()).toMatchObject({
      authenticated: false,
      authMethod: 'none',
    });
    for (const runtime of apps) {
      const port = runtime.app.getHttpServer().address().port;
      const response = await fetch(`http://127.0.0.1:${port}/api/zai/usage`, {
        headers: { 'x-api-key': 'offline-fixture' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ quotaLimits: { planType: 'unknown' } });
    }
    await firstZai.verifyApiKey('explicit-offline-verification');
    expect(received).toEqual([
      { path: '/one/quota', knownAuthorization: true },
      { path: '/two/quota', knownAuthorization: true },
      { path: '/one/quota', knownAuthorization: true },
    ]);
    await first.app.close();
    expect(secondZai.getApiToken() === 'offline-zai-two').toBe(true);
    expect(await second.app.get(GeminiUsageService).isAvailable()).toBe(false);
  } finally {
    await Promise.all(apps.map(({ app }) => app.close()));
    vi.unstubAllGlobals();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(directory, { recursive: true, force: true });
  }
});

it.skipIf(process.platform !== 'linux')(
  'passes current managed Claude credentials to a real offline PTY child without shell expansion',
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-usage-pty-'));
    const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
    const before = { ...process.env };
    try {
      for (const name of ['one', 'two']) {
        const root = path.join(directory, `${name} "$literal" $(not-a-command)`);
        const bin = path.join(root, 'bin');
        const capture = path.join(root, 'capture.json');
        await mkdir(bin, { recursive: true });
        await writeFile(
          path.join(bin, 'claude'),
          `#!${process.execPath}
const fs = require('node:fs');
const digest = (value) => value ? require('node:crypto').createHash('sha256').update(value).digest('hex') : null;
fs.writeFileSync(process.env.USAGE_CAPTURE, JSON.stringify({
  key: digest(process.env.ANTHROPIC_API_KEY), oauth: digest(process.env.CLAUDE_CODE_OAUTH_TOKEN),
  home: process.env.HOME, cwd: process.cwd(), args: process.argv.slice(2),
  omitted: process.env.OPENAI_API_KEY ?? null
}));
console.log('Offline usage fixture');
`,
          { mode: 0o700 }
        );
        const runtime = await createNestApplication({
          host: '127.0.0.1',
          port: 0,
          workingDirectory: root,
          dataDir: path.join(root, 'data'),
          runStartupTasks: false,
          enableShutdownHooks: false,
          environment: {
            NODE_ENV: 'test',
            HOME: root,
            PATH: `${bin}:/usr/bin:/bin`,
            USAGE_CAPTURE: capture,
            ANTHROPIC_API_KEY: `sk-ant-bootstrap-${name}`,
            CLAUDE_CODE_OAUTH_TOKEN: `bootstrap-oauth-${name}`,
            ENABLE_REQUEST_LOGGING: 'false',
          },
        });
        apps.push(runtime);
      }
      const [first, second] = apps;
      const read = async (index: number) => {
        const root = path.join(
          directory,
          `${index === 0 ? 'one' : 'two'} "$literal" $(not-a-command)`
        );
        await apps[index].app.get(ClaudeUsageService).fetchUsageData();
        return { root, child: JSON.parse(await readFile(path.join(root, 'capture.json'), 'utf8')) };
      };
      await first.app
        .get(ApplicationCredentialsService)
        .change('anthropic', 'sk-ant-managed-offline-one');
      const initial = await read(0);
      expect(initial.child).toEqual({
        key: digest('sk-ant-managed-offline-one'),
        oauth: null,
        home: initial.root,
        cwd: initial.root,
        args: ['--add-dir', initial.root],
        omitted: null,
      });
      const independent = await read(1);
      expect(independent.child.key).toBe(digest('sk-ant-bootstrap-two'));
      expect(independent.child.oauth).toBe(digest('bootstrap-oauth-two'));
      await first.app.get(ApplicationCredentialsService).change('anthropic', null);
      await first.app.get(ApplicationCredentialsService).change('anthropic_oauth_token', null);
      const deleted = await read(0);
      expect(deleted.child.key).toBeNull();
      expect(deleted.child.oauth).toBeNull();
      await first.app.close();
      expect((await read(1)).child.key).toBe(digest('sk-ant-bootstrap-two'));
      expect(
        Object.keys({ ...before, ...process.env }).filter((key) => before[key] !== process.env[key])
      ).toEqual([]);
    } finally {
      await Promise.all(apps.map(({ app }) => app.close()));
      await rm(directory, { recursive: true, force: true });
    }
  }
);
