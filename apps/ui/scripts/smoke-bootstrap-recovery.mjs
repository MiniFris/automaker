import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from '@playwright/test';

// Run after the UI production build. Never starts a vendor client or uses a real backend.
const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const html = await readFile(path.join(root, 'index.html'));
let failModules = true;
let failedModules = 0;
let documents = 0;
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (pathname.startsWith('/api/')) {
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: false, error: 'Offline bootstrap fixture.' }));
      return;
    }
    if (pathname.endsWith('.js') && failModules) {
      failedModules++;
      response.writeHead(503, { 'Content-Type': 'text/javascript' });
      response.end('');
      return;
    }
    if (pathname === '/') {
      documents++;
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(html);
      return;
    }
    const file = path.resolve(root, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(root + path.sep)) {
      response.writeHead(404).end();
      return;
    }
    const content = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});
let browser;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort('blockedbyclient')
  );
  const page = await context.newPage();
  await page.addInitScript(() => {
    globalThis.localStorage.setItem('automaker-ui-locale', 'en');
    globalThis.localStorage.setItem('automaker-disable-splash', 'true');
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const alert = page.getByRole('alert');
  await alert.waitFor({ state: 'visible', timeout: 5000 });
  assert.match(await alert.textContent(), /Unable to load Automaker/);
  assert.equal(await page.locator('.app-shell-spinner').isVisible(), false);
  assert.ok(failedModules > 0);
  assert.equal(documents, 1);
  await page.evaluate(() =>
    globalThis.localStorage.setItem('bootstrap-recovery-fixture', 'preserved')
  );
  failModules = false;
  await alert.getByRole('button', { name: 'Reload', exact: true }).click();
  await page.waitForFunction(
    () => !globalThis.document.querySelector('#app > .app-shell'),
    undefined,
    {
      timeout: 10000,
    }
  );
  assert.equal(documents, 2);
  assert.equal(
    await page.evaluate(() => globalThis.localStorage.getItem('bootstrap-recovery-fixture')),
    'preserved'
  );
  console.log(
    JSON.stringify({
      artifact: 'UI production HTML/modules',
      failureShown: true,
      explicitReloadRecovered: true,
      storagePreserved: true,
    })
  );
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}
