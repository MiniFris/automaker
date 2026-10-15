import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { expect, it } from 'vitest';
import type { Browser } from 'playwright';
import type { ViteDevServer } from 'vite';
import { SettingsService } from '@/services/settings-service.js';
import { createOpenAICompatibleSettingsRoutes } from '@/routes/settings/openai-compatible.js';

// Explicit opt-in: no downloads, no shared app/settings server, no real model requests.
it.skipIf(!process.env.DIRECT_PROVIDER_BROWSER_EXECUTABLE)('browser: settings → catalog → tool probe → shared endpoint/model selection → reload', async () => {
  const { chromium } = await import('playwright');
  const { createServer: createViteServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'direct-browser-test-'));
  let browser: Browser | undefined;
  let vite: ViteDevServer | undefined;
  let appServer: Server | undefined;
  let upstream: Server | undefined;
  const calls: Array<{ path: string; auth?: string }> = [];
  async function listen(server: Server) {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
  try {
    upstream = createServer((req, res) => { void (async () => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      calls.push({ path: req.url!, auth: req.headers.authorization });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'direct-Vendor/Exact:Tag' }] }));
      else res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'browser-probe', type: 'function', function: { name: 'automaker_connection_check', arguments: '{"marker":"ok"}' } }] }, finish_reason: 'tool_calls' }] }));
    })().catch(() => { res.statusCode = 500; res.end(); }); });
    const upstreamUrl = await listen(upstream) + '/v1/';
    const settings = new SettingsService(path.join(temporary, 'data'));
    const app = express(); app.use(express.json());
    app.use('/api/settings/openai-compatible', createOpenAICompatibleSettingsRoutes(settings));
    appServer = createServer(app); const origin = await listen(appServer);
    const uiRoot = path.resolve(import.meta.dirname, '../../../ui');
    vite = await createViteServer({ root: uiRoot, configFile: false, plugins: [react()], cacheDir: path.join(temporary, 'vite-cache'), logLevel: 'error',
      resolve: { alias: { '@': path.join(uiRoot, 'src') }, dedupe: ['react', 'react-dom'] },
      define: { 'import.meta.env.VITE_SERVER_URL': JSON.stringify(origin) },
      optimizeDeps: { entries: [path.join(uiRoot, 'tests/browser-fixtures/direct-provider.tsx')] },
      server: { middlewareMode: true, hmr: false, fs: { allow: [path.resolve(uiRoot, '../..'), temporary] } },
    });
    app.get('/direct-provider-smoke', async (_req, res) => { res.type('html').send(await vite!.transformIndexHtml('/direct-provider-smoke', '<!doctype html><html><head><title>Direct provider test</title></head><body><div id="root"></div><script type="module" src="/tests/browser-fixtures/direct-provider.tsx"></script></body></html>')); });
    app.use(vite.middlewares);
    browser = await chromium.launch({ executablePath: process.env.DIRECT_PROVIDER_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage(); page.setDefaultTimeout(15_000);
    const pageErrors: string[] = []; page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(origin + '/direct-provider-smoke');
    await page.getByRole('button', { name: 'Add direct endpoint' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Browser endpoint');
    await page.getByLabel('API base URL').fill(upstreamUrl);
    await page.getByLabel('New API key', { exact: false }).fill('browser-private-fixture-key');
    const savedResponse = page.waitForResponse((response) => response.url().endsWith('/endpoint') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save endpoint', exact: true }).click();
    const saved = await (await savedResponse).json(); expect(saved.success).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('browser-private-fixture-key');
    await page.getByRole('button', { name: 'Fetch /models' }).click();
    await page.getByLabel('Discovered models').selectOption('direct-Vendor/Exact:Tag');
    await page.getByLabel('Display name').fill('Browser model');
    await page.getByLabel('tools', { exact: true }).check();
    const modelResponse = page.waitForResponse((response) => response.url().endsWith('/endpoint') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save endpoint', exact: true }).click();
    expect((await (await modelResponse).json()).success).toBe(true);
    await page.getByRole('button', { name: 'Test tools', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Tool calling verified' }).waitFor();
    await page.getByRole('option', { name: 'Browser model', exact: true }).click();
    expect(JSON.parse(await page.getByTestId('direct-browser-selection').innerText())).toEqual({ model: 'direct-direct-Vendor/Exact:Tag', providerId: saved.endpoints[0].endpoint.id });
    expect(calls.map((call) => call.path)).toEqual(['/v1/models', '/v1/chat/completions']);
    expect(calls.every((call) => call.auth === 'Bearer browser-private-fixture-key')).toBe(true);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('browser-private-fixture-key');
    await page.reload();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    expect(await page.getByLabel(/New API key/).inputValue()).toBe('');
    expect(await page.getByLabel('Model ID').inputValue()).toBe('direct-Vendor/Exact:Tag');
    expect(pageErrors).toEqual([]);
  } finally {
    await browser?.close(); await vite?.close();
    for (const server of [appServer, upstream]) if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
    await fs.rm(temporary, { recursive: true, force: true });
  }
}, 60_000);
