import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { expect, it, vi } from 'vitest';
import type { Browser } from 'playwright';
import type { ViteDevServer } from 'vite';
import { nativeSettings, diagnosticRunner } from '../helpers/native-settings.js';
import { sshPeer, testSSHKey } from '../helpers/ssh-peer.js';

// Explicit opt-in: no downloads, no shared app/settings server, no real model requests.
it.skipIf(!process.env.DIRECT_PROVIDER_BROWSER_EXECUTABLE)(
  'browser: settings → catalog → tool probe → shared endpoint/model selection → reload',
  async () => {
    const { chromium } = await import('playwright');
    const { createServer: createViteServer } = await import('vite');
    const { default: react } = await import('@vitejs/plugin-react');
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'direct-browser-test-'));
    let browser: Browser | undefined;
    let vite: ViteDevServer | undefined;
    let appServer: Server | undefined;
    let backend: Awaited<ReturnType<typeof nativeSettings>> | undefined;
    let upstream: Server | undefined;
    let remotePeer: Awaited<ReturnType<typeof sshPeer>> | undefined;
    const calls: Array<{ path: string; auth?: string }> = [];
    async function listen(server: Server) {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    }
    try {
      upstream = createServer((req, res) => {
        void (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          calls.push({ path: req.url!, auth: req.headers.authorization });
          res.setHeader('Content-Type', 'application/json');
          if (req.url === '/v1/models')
            res.end(JSON.stringify({ data: [{ id: 'direct-Vendor/Exact:Tag' }] }));
          else
            res.end(
              JSON.stringify({
                choices: [
                  {
                    index: 0,
                    message: {
                      role: 'assistant',
                      content: null,
                      tool_calls: [
                        {
                          id: 'browser-probe',
                          type: 'function',
                          function: {
                            name: 'automaker_connection_check',
                            arguments: '{"marker":"ok"}',
                          },
                        },
                      ],
                    },
                    finish_reason: 'tool_calls',
                  },
                ],
              })
            );
        })().catch(() => {
          res.statusCode = 500;
          res.end();
        });
      });
      const upstreamUrl = (await listen(upstream)) + '/v1/';
      backend = await nativeSettings(temporary);
      const docker = backend.docker;
      diagnosticRunner(backend, async () => ({
        code: 0,
        stdout: JSON.stringify('29.1.0'),
        stderr: '',
      }));
      const prepare = vi.spyOn(docker, 'probe').mockResolvedValue({
        connection: 'available',
        containerLifecycle: 'verified',
        projectStorage: 'not-tested',
        checkedAt: new Date().toISOString(),
        message: 'Browser lifecycle fixture verified without project storage',
      });
      const app = express();
      app.use(express.json());
      appServer = createServer(app);
      const origin = await listen(appServer);
      const uiRoot = path.resolve(import.meta.dirname, '../../../ui');
      vite = await createViteServer({
        root: uiRoot,
        configFile: false,
        plugins: [react()],
        cacheDir: path.join(temporary, 'vite-cache'),
        logLevel: 'error',
        resolve: { alias: { '@': path.join(uiRoot, 'src') }, dedupe: ['react', 'react-dom'] },
        define: { 'import.meta.env.VITE_SERVER_URL': JSON.stringify(backend.origin) },
        optimizeDeps: {
          entries: [path.join(uiRoot, 'tests/browser-fixtures/direct-provider.tsx')],
        },
        server: {
          middlewareMode: true,
          hmr: false,
          fs: { allow: [path.resolve(uiRoot, '../..'), temporary] },
        },
      });
      app.get('/direct-provider-smoke', async (_req, res) => {
        res
          .type('html')
          .send(
            await vite!.transformIndexHtml(
              '/direct-provider-smoke',
              '<!doctype html><html><head><title>Direct provider test</title></head><body><div id="root"></div><script type="module" src="/tests/browser-fixtures/direct-provider.tsx"></script></body></html>'
            )
          );
      });
      app.use(vite.middlewares);
      // Finish the initial static-import crawl/prebundle before a no-HMR browser opens it.
      // Otherwise a cold optimizer can invalidate module URLs during the first navigation.
      const clientEnvironment = vite.environments.client;
      await clientEnvironment.warmupRequest('/tests/browser-fixtures/direct-provider.tsx');
      await clientEnvironment.waitForRequestsIdle();
      await Promise.all(
        Object.values(clientEnvironment.depsOptimizer?.metadata.discovered ?? {}).map(
          (dependency) => dependency.processing
        )
      );
      browser = await chromium.launch({
        executablePath: process.env.DIRECT_PROVIDER_BROWSER_EXECUTABLE,
        headless: true,
        args: ['--no-sandbox'],
      });
      const page = await browser.newPage();
      page.setDefaultTimeout(15_000);
      const pageErrors: string[] = [];
      const bootstrapDiagnostics: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' && bootstrapDiagnostics.length < 10)
          bootstrapDiagnostics.push(message.text());
      });
      page.on('response', (response) => {
        if (response.status() >= 400 && bootstrapDiagnostics.length < 10)
          bootstrapDiagnostics.push(`${response.status()} ${response.url()}`);
      });
      page.on('requestfailed', (request) => {
        if (bootstrapDiagnostics.length < 10)
          bootstrapDiagnostics.push(`${request.failure()?.errorText} ${request.url()}`);
      });
      await page.route('**/*', (route) =>
        new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
      );
      await page.goto(origin + '/direct-provider-smoke');
      await page
        .getByRole('button', { name: 'Add direct endpoint' })
        .click()
        .catch(async (error) => {
          throw new Error(
            `${error.message}; browser bootstrap errors: ${pageErrors.join('; ')}; network/console: ${bootstrapDiagnostics.join('; ')}; body: ${(await page.locator('body').innerText()).slice(0, 500)}`
          );
        });
      await page.getByLabel('Name', { exact: true }).fill('Browser endpoint');
      await page.getByLabel('API base URL').fill(upstreamUrl);
      await page.getByLabel('New API key', { exact: false }).fill('browser-private-fixture-key');
      const savedResponse = page.waitForResponse(
        (response) => response.url().endsWith('/endpoint') && response.request().method() === 'PUT'
      );
      await page.getByRole('button', { name: 'Save endpoint', exact: true }).click();
      const saved = await (await savedResponse).json();
      expect(saved.success).toBe(true);
      expect(JSON.stringify(saved)).not.toContain('browser-private-fixture-key');
      await page.getByRole('button', { name: 'Fetch /models' }).click();
      await page.getByLabel('Discovered models').selectOption('direct-Vendor/Exact:Tag');
      await page.getByLabel('Display name').fill('Browser model');
      await page.getByLabel('tools', { exact: true }).check();
      const modelResponse = page.waitForResponse(
        (response) => response.url().endsWith('/endpoint') && response.request().method() === 'PUT'
      );
      await page.getByRole('button', { name: 'Save endpoint', exact: true }).click();
      expect((await (await modelResponse).json()).success).toBe(true);
      await page.getByRole('button', { name: 'Test tools', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Tool calling verified' }).waitFor();
      await page.getByRole('option', { name: 'Browser model', exact: true }).click();
      expect(JSON.parse(await page.getByTestId('direct-browser-selection').innerText())).toEqual({
        model: 'direct-direct-Vendor/Exact:Tag',
        providerId: saved.endpoints[0].endpoint.id,
      });
      expect(calls.map((call) => call.path)).toEqual(['/v1/models', '/v1/chat/completions']);
      expect(calls.every((call) => call.auth === 'Bearer browser-private-fixture-key')).toBe(true);
      expect(await page.evaluate(() => JSON.stringify(globalThis.localStorage))).not.toContain(
        'browser-private-fixture-key'
      );
      await page
        .getByRole('checkbox', { name: /I understand and accept unrestricted Local/ })
        .check();
      await page.getByRole('button', { name: 'Enable Local execution', exact: true }).click();
      await page.getByText('Local access confirmed (global scope).', { exact: true }).waitFor();
      await page.reload();
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      expect(await page.getByLabel(/New API key/).inputValue()).toBe('');
      expect(await page.getByLabel('Model ID').inputValue()).toBe('direct-Vendor/Exact:Tag');
      await page.getByText('Local access confirmed (global scope).', { exact: true }).waitFor();
      expect(prepare).not.toHaveBeenCalled();
      await page.getByLabel('Default execution environment').selectOption('auto');
      await page.getByRole('button', { name: 'Save environment configuration' }).click();
      await page.getByRole('button', { name: 'Allow Auto Local fallback' }).waitFor();
      await page.getByRole('checkbox', { name: /Allow image download\/build/ }).check();
      await page
        .getByRole('button', { name: 'Prepare and verify saved Docker environment' })
        .click();
      await page
        .getByText('Browser lifecycle fixture verified without project storage', { exact: true })
        .waitFor();
      expect(prepare).toHaveBeenCalledTimes(1);
      await page
        .getByRole('checkbox', { name: /I accept full Local access if Docker preflight/ })
        .check();
      await page.getByRole('button', { name: 'Allow Auto Local fallback' }).click();
      await page.getByText(/Auto Local fallback confirmed \(global scope\)/).waitFor();
      await page.reload();
      await page.getByText(/Auto Local fallback confirmed \(global scope\)/).waitFor();
      expect(prepare).toHaveBeenCalledTimes(1);
      // Actual SSH peer: global setup is explicit; reload must not reconnect/install again.
      const privateKey = testSSHKey();
      const remoteRoot = path.join(temporary, 'ssh-remote');
      remotePeer = await sshPeer(remoteRoot, privateKey);
      await page.getByRole('button', { name: 'Add SSH profile' }).click();
      await page.getByLabel('Profile name', { exact: true }).fill('Browser SSH');
      await page.getByLabel('SSH host', { exact: true }).fill('127.0.0.1');
      await page.getByLabel('SSH port', { exact: true }).fill(String(remotePeer.port));
      await page.getByLabel('SSH user', { exact: true }).fill('developer');
      await page.getByLabel('Remote projects base path').fill(path.join(remoteRoot, 'projects'));
      await page.getByLabel('SSH credential ID (empty = server ssh-agent)').fill('browser-ssh');
      await page
        .getByLabel('Default execution environment')
        .selectOption({ label: 'Browser SSH (SSH)' });
      await page.getByRole('button', { name: 'Save environment configuration' }).click();
      await page.getByRole('button', { name: 'Inspect SSH host fingerprint' }).waitFor();
      expect(remotePeer.authentications).toBe(0);
      expect(remotePeer.commands).toEqual([]);
      await page.getByRole('button', { name: 'Inspect SSH host fingerprint' }).click();
      await page
        .getByRole('checkbox', { name: 'I independently verified this SSH fingerprint' })
        .check();
      await page.getByRole('button', { name: 'Confirm SSH fingerprint' }).click();
      await page
        .getByText('SSH fingerprint confirmed. Existing runs are not migrated.', { exact: true })
        .waitFor();
      expect(remotePeer.authentications).toBe(0);
      await page.getByLabel('SSH private key (server storage only)').fill(privateKey);
      await page.getByRole('button', { name: 'Save SSH private key' }).click();
      await page
        .getByText('SSH key saved on the server; it is never returned by the API.', { exact: true })
        .waitFor();
      expect(await page.getByLabel('SSH private key (server storage only)').inputValue()).toBe('');
      await page.getByRole('checkbox', { name: /I allow remote worker installation/ }).check();
      await page.getByRole('button', { name: 'Prepare saved SSH worker' }).click();
      await page
        .getByText('Versioned SSH worker prepared. No project was copied by this action.', {
          exact: true,
        })
        .waitFor();
      const commandCount = remotePeer.commands.length;
      expect(commandCount).toBeGreaterThan(0);
      await page.reload();
      await page.getByRole('button', { name: 'Inspect SSH host fingerprint' }).waitFor();
      expect(await page.getByLabel('SSH private key (server storage only)').inputValue()).toBe('');
      expect(remotePeer.commands).toHaveLength(commandCount);
      expect(await page.evaluate(() => JSON.stringify(globalThis.localStorage))).not.toContain(
        'PRIVATE KEY'
      );
      expect(pageErrors).toEqual([]);
    } finally {
      await browser?.close();
      await vite?.close();
      await backend?.close();
      await remotePeer?.close();
      for (const server of [appServer, upstream])
        if (server) {
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      await fs.rm(temporary, { recursive: true, force: true });
    }
  },
  60_000
);
