import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAICompatibleEndpoint } from '@automaker/types';
import { SettingsService } from '@/services/settings-service.js';
import { createOpenAICompatibleSettingsRoutes } from '@/routes/settings/openai-compatible.js';

describe('direct endpoint settings / HTTP and local mock endpoint', () => {
  let temporary: string;
  let settings: SettingsService;
  let upstream: Server;
  let appServer: Server;
  let baseUrl: string;
  let apiUrl: string;
  let upstreamCalls: Array<{ path: string; authorization?: string; body: Record<string, unknown> }>;
  let respond: (res: ServerResponse, body: Record<string, unknown>) => void;
  let catalog: (res: ServerResponse) => void;
  async function listen(server: Server) {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
  function endpoint(id = 'endpoint-a'): OpenAICompatibleEndpoint {
    return { id, name: id, enabled: true, baseUrl, protocol: 'chat-completions', auth: { type: 'credentials', credentialId: id }, models: [{ id: 'Vendor/Model:latest', displayName: 'Model', capabilities: { tools: true, streaming: false } }] };
  }
  async function request(method: string, route = '', body?: unknown) {
    const res = await fetch(apiUrl + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: res.status, data: await res.json() };
  }
  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'direct-settings-test-'));
    settings = new SettingsService(path.join(temporary, 'data'));
    upstreamCalls = [];
    catalog = (res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'Vendor/Model:latest' }, { id: 'direct-MixedCase/Exact:Tag' }] })); };
    respond = (res, body) => {
      res.setHeader('Content-Type', 'application/json');
      if (body.tools) res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'check', type: 'function', function: { name: 'automaker_connection_check', arguments: '{"marker":"ok"}' } }] }, finish_reason: 'tool_calls' }] }));
      else res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }));
    };
    upstream = createServer((req, res) => { void (async () => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      upstreamCalls.push({ path: req.url!, authorization: req.headers.authorization, body });
      if (req.url === '/v1/models') {
        catalog(res);
      } else respond(res, body);
    })().catch(() => { res.statusCode = 500; res.end(); }); });
    baseUrl = await listen(upstream) + '/v1/';
    const app = express(); app.use(express.json()); app.use('/direct', createOpenAICompatibleSettingsRoutes(settings));
    appServer = createServer(app); apiUrl = await listen(appServer) + '/direct';
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const server of [appServer, upstream]) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
    await fs.rm(temporary, { recursive: true, force: true });
  });

  it('lists secret-free defaults and saves endpoints with write-only keys', async () => {
    expect((await request('GET')).data).toMatchObject({ success: true, endpoints: [], agentSettings: { access: 'read-only' } });
    const saved = await request('PUT', '/endpoint', { endpoint: endpoint(), apiKey: 'private-api-key-first' });
    expect(saved.status).toBe(200);
    expect(saved.data.endpoints[0]).toMatchObject({ keyConfigured: true, endpoint: { id: 'endpoint-a' } });
    expect(JSON.stringify(saved.data)).not.toContain('private-api-key-first');
    expect(JSON.stringify(await settings.getGlobalSettings())).not.toContain('private-api-key-first');
    expect((await settings.getCredentials()).openaiCompatibleApiKeys?.['endpoint-a']).toBe('private-api-key-first');
  });

  it('keeps the old key when updating endpoint metadata without a key field', async () => {
    await request('PUT', '/endpoint', { endpoint: endpoint(), apiKey: 'keep-this-key' });
    const edited = { ...endpoint(), name: 'Renamed' };
    expect((await request('PUT', '/endpoint', { endpoint: edited })).data.success).toBe(true);
    expect((await settings.getCredentials()).openaiCompatibleApiKeys?.['endpoint-a']).toBe('keep-this-key');
  });

  it.skipIf(process.platform === 'win32')('writes credential files privately, including backups of new private files', async () => {
    await request('PUT', '/endpoint', { endpoint: endpoint(), apiKey: 'private-file-first-key' });
    await request('PUT', '/endpoint', { endpoint: endpoint(), apiKey: 'private-file-next-key' });
    for (const file of ['credentials.json', 'credentials.json.bak1'])
      expect((await fs.stat(path.join(settings.getDataDirectory(), file))).mode & 0o777).toBe(0o600);
  });

  it('updates keys independently and clears only on explicit request', async () => {
    await request('PUT', '/endpoint', { endpoint: endpoint(), apiKey: 'first-key-value' });
    await request('PUT', '/endpoint', { endpoint: endpoint('endpoint-b'), apiKey: 'second-key-value' });
    const cleared = await request('PUT', '/endpoint', { endpoint: endpoint(), clearKey: true });
    expect(cleared.data.endpoints.map((item: { keyConfigured: boolean }) => item.keyConfigured)).toEqual([false, true]);
    expect((await settings.getCredentials()).openaiCompatibleApiKeys?.['endpoint-b']).toBe('second-key-value');
  });

  it('serializes concurrent per-endpoint edits without losing a sibling endpoint', async () => {
    const results = await Promise.all(['endpoint-a', 'endpoint-b'].map((id) => request('PUT', '/endpoint', { endpoint: endpoint(id), apiKey: `key-${id}` })));
    expect(results.every((result) => result.status === 200)).toBe(true);
    expect((await settings.getGlobalSettings()).openaiCompatibleEndpoints?.map((item) => item.id).sort()).toEqual(['endpoint-a', 'endpoint-b']);
  });

  it('can remove the last endpoint without wiping shared credentials', async () => {
    await request('PUT', '/endpoint', { endpoint: endpoint(), apiKey: 'retained-key-value' });
    expect((await request('POST', '/remove', { providerId: 'endpoint-a' })).data.endpoints).toEqual([]);
    expect((await settings.getCredentials()).openaiCompatibleApiKeys?.['endpoint-a']).toBe('retained-key-value');
  });

  it('supports none/env auth but exposes only a configured boolean', async () => {
    vi.stubEnv('DIRECT_SETTINGS_TEST_KEY', 'private-env-key-value');
    await request('PUT', '/endpoint', { endpoint: { ...endpoint(), auth: { type: 'env', variableName: 'DIRECT_SETTINGS_TEST_KEY' } } });
    const listed = await request('GET');
    expect(listed.data.endpoints[0].keyConfigured).toBe(true);
    expect(JSON.stringify(listed.data)).not.toContain('private-env-key-value');
    await request('PUT', '/endpoint', { endpoint: { ...endpoint('none'), auth: { type: 'none' } } });
    expect((await request('GET')).data.endpoints).toHaveLength(2);
  });

  it.each([
    { apiKey: 'bad\nsecret' }, { apiKey: '' }, { apiKey: 'new', clearKey: true },
    { clearKey: 'yes' }, { rawCredentials: 'secret' },
  ])('rejects invalid secret updates without echoing request values (%#)', async (extra) => {
    const result = await request('PUT', '/endpoint', { endpoint: endpoint(), ...extra });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.data)).not.toContain('secret');
    expect((await settings.getGlobalSettings()).openaiCompatibleEndpoints ?? []).toEqual([]);
  });

  it('rejects secret fields inside endpoint JSON and raw keys in global settings', async () => {
    const invalid = await request('PUT', '/endpoint', { endpoint: { ...endpoint(), apiKey: 'do-not-store' } });
    expect(invalid.status).toBe(400);
    await expect(settings.updateGlobalSettings({ openaiCompatibleApiKeys: { x: 'do-not-store' } } as never)).rejects.toThrow('Secrets');
  });

  it('saves explicit permissions and disables shell by omission rather than merging old grants', async () => {
    const first = await request('PUT', '/agent', { access: 'workspace-write', shell: { backend: 'docker', image: `sha256:${'a'.repeat(64)}` } });
    expect(first.data.agentSettings.shell.backend).toBe('docker');
    const second = await request('PUT', '/agent', { access: 'read-only' });
    expect(second.data.agentSettings).toEqual({ access: 'read-only' });
  });

  it.each([{ access: 'full-access' }, { access: 'workspace-write', onCheckpoint: 'injected' }, { limits: { toolTimeoutMs: 0 } }, { shell: { backend: 'docker', image: 'alpine:latest' } }])('rejects untrusted runtime controls (%#)', async (body) => {
    expect((await request('PUT', '/agent', body)).status).toBe(400);
  });

  it('discovers exact opaque IDs without changing the saved model capabilities', async () => {
    await request('PUT', '/endpoint', { endpoint: endpoint(), apiKey: 'catalog-key-value' });
    const result = await request('POST', '/models', { providerId: 'endpoint-a' });
    expect(result.data.models).toEqual(['Vendor/Model:latest', 'direct-MixedCase/Exact:Tag']);
    expect(upstreamCalls.at(-1)).toMatchObject({ path: '/v1/models', authorization: 'Bearer catalog-key-value' });
    expect((await settings.getGlobalSettings()).openaiCompatibleEndpoints?.[0].models).toHaveLength(1);
  });

  it('never forwards catalog credentials to redirects', async () => {
    await request('PUT', '/endpoint', { endpoint: endpoint(), apiKey: 'redirect-protected-key' });
    catalog = (res) => { res.statusCode = 302; res.setHeader('Location', '/should-not-follow'); res.end('private upstream body'); };
    const result = await request('POST', '/models', { providerId: 'endpoint-a' });
    expect(result.status).toBe(400); expect(JSON.stringify(result.data)).not.toContain('private upstream body');
    expect(upstreamCalls.map((call) => call.path)).toEqual(['/v1/models']);
  });

  it.each(['oversized', 'invalid-id', 'too-many'])('bounds and validates the catalog (%s)', async (kind) => {
    await request('PUT', '/endpoint', { endpoint: { ...endpoint(), auth: { type: 'none' } } });
    catalog = (res) => { res.end(kind === 'oversized' ? 'x'.repeat(1024 * 1024 + 1) : JSON.stringify({ data: kind === 'invalid-id' ? [{ id: 'invalid\nID' }] : Array.from({ length: 2001 }, (_, id) => ({ id: `model-${id}` })) })); };
    expect((await request('POST', '/models', { providerId: 'endpoint-a' })).status).toBe(400);
  });

  it('verifies text and harmless function calling, without registering filesystem/shell tools', async () => {
    await request('PUT', '/endpoint', { endpoint: endpoint(), apiKey: 'probe-key-value' });
    for (const tools of [false, true]) expect((await request('POST', '/test', { providerId: 'endpoint-a', modelId: 'Vendor/Model:latest', tools })).data).toMatchObject({ success: true, verified: true });
    expect(upstreamCalls.map((call) => call.body.model)).toEqual(['Vendor/Model:latest', 'Vendor/Model:latest']);
    expect(JSON.stringify(upstreamCalls.at(-1)?.body)).toContain('automaker_connection_check');
    expect(JSON.stringify(upstreamCalls.at(-1)?.body)).not.toContain('Bash');
  });

  it('does not claim tools are supported if the model only answers with text', async () => {
    await request('PUT', '/endpoint', { endpoint: { ...endpoint(), auth: { type: 'none' } } });
    respond = (res) => { res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] })); };
    expect((await request('POST', '/test', { providerId: 'endpoint-a', modelId: 'Vendor/Model:latest', tools: true })).status).toBe(400);
  });

  it('fails verification cleanly when tool-call arguments are not valid JSON', async () => {
    await request('PUT', '/endpoint', { endpoint: endpoint(), apiKey: 'probe-key-value' });
    respond = (res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'check', type: 'function', function: { name: 'automaker_connection_check', arguments: '{"marker":"ok"' } }] }, finish_reason: 'tool_calls' }] })); };
    const result = await request('POST', '/test', { providerId: 'endpoint-a', modelId: 'Vendor/Model:latest', tools: true });
    expect(result.status).toBe(400);
    expect(result.data.error).toBe('OpenAI-compatible: Invalid or incomplete Chat Completions response.');
  });

  it('rejects absent endpoints, unknown models and malformed probe modes before HTTP', async () => {
    await request('PUT', '/endpoint', { endpoint: { ...endpoint(), auth: { type: 'none' } } });
    for (const body of [{ providerId: 'missing', modelId: 'Vendor/Model:latest' }, { providerId: 'endpoint-a', modelId: 'unknown' }, { providerId: 'endpoint-a' }, { providerId: 'endpoint-a', modelId: 'Vendor/Model:latest', tools: 'true' }])
      expect((await request('POST', '/test', body)).status).toBe(400);
    expect(upstreamCalls).toEqual([]);
  });

  it('redacts upstream errors rather than returning their response body', async () => {
    await request('PUT', '/endpoint', { endpoint: endpoint(), apiKey: 'upstream-key-value' });
    respond = (res) => { res.statusCode = 401; res.end('upstream-key-value sensitive upstream payload'); };
    const result = await request('POST', '/test', { providerId: 'endpoint-a', modelId: 'Vendor/Model:latest' });
    expect(result.status).toBe(400); expect(JSON.stringify(result.data)).not.toMatch(/upstream-key-value|sensitive/);
  });
});
