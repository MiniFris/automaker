import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { NodeCodexVerificationRuntime } from '../../../src/core/platform/codex-verification.runtime.js';

afterEach(() => vi.unstubAllGlobals());
const completed = {
  type: 'response.completed',
  response: {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
  },
};
const event = (body: unknown) => `event: response\ndata: ${JSON.stringify(body)}\n\n`;
function input(endpoint = 'https://offline.invalid/responses') {
  return {
    endpoint,
    model: 'gpt-5.2-codex' as const,
    authMethod: 'api_key' as const,
    credentialKind: 'api-key' as const,
    apiKey: 'sk-offline-api-key-fixture-123',
    controller: new AbortController(),
  };
}
it('sends a single real HTTP request without tools, follows no redirects and never launches CLI for API key mode', async () => {
  const calls: unknown[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    calls.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(event(completed));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const read = vi.fn();
  try {
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/responses`;
    expect(await new NodeCodexVerificationRuntime({ read }).run(input(endpoint))).toBe('verified');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      tools: [],
      tool_choice: 'none',
      store: false,
      stream: true,
      model: 'gpt-5.2-codex',
    });
    expect(read).not.toHaveBeenCalled();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it.each([
  [event({ type: 'response.output_text.delta', delta: 'ok' }), 'no-response'],
  [event({ type: 'response.completed', response: { status: 'incomplete', output: [] } }), 'failed'],
  [
    event({
      type: 'response.completed',
      response: { status: 'completed', output: [{ type: 'function_call', name: 'shell' }] },
    }),
    'failed',
  ],
  [
    event({ type: 'response.failed', response: { error: { code: 'insufficient_quota' } } }),
    'billing',
  ],
  [event({ type: 'error', error: { code: 'rate_limit_exceeded' } }), 'rate-limit'],
  [event({ type: 'error', error: { code: 'invalid_api_key' } }), 'authentication'],
  ['x'.repeat(131073), 'failed'],
  ['data: not-json\n\n', 'failed'],
] as const)(
  'never treats partial/error/tool/oversized SSE as verified (%#)',
  async (body, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    expect(await new NodeCodexVerificationRuntime({ read: vi.fn() }).run(input())).toBe(expected);
  }
);
it.each([
  [401, 'authentication'],
  [402, 'billing'],
  [429, 'rate-limit'],
  [500, 'failed'],
] as const)('normalizes HTTP %s without exposing response secrets', async (status, expected) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('private-fixture-secret', { status }))
  );
  expect(await new NodeCodexVerificationRuntime({ read: vi.fn() }).run(input())).toBe(expected);
});
it('uses CLI credentials only after auth opt-in and refuses a changed credential kind', async () => {
  const request = vi.fn().mockResolvedValue(new Response(event(completed), { status: 200 }));
  vi.stubGlobal('fetch', request);
  const read = vi.fn().mockResolvedValue({ kind: 'api-key', token: 'sk-offline-cli-key' });
  const value = { ...input(), authMethod: 'cli' as const, apiKey: undefined };
  expect(await new NodeCodexVerificationRuntime({ read }).run(value)).toBe('verified');
  expect(read).toHaveBeenCalledWith(true, value.controller);
  expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-offline-cli-key');
  read.mockResolvedValue({ kind: 'chatgpt', token: 'opaque' });
  expect(await new NodeCodexVerificationRuntime({ read }).run(value)).toBe('authentication');
  expect(request).toHaveBeenCalledOnce();
});
it('sets a ChatGPT account header from CLI token metadata without treating the JWT as proof of authentication', async () => {
  const token = `e30.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account' } })).toString('base64url')}.fixture`;
  const read = vi.fn().mockResolvedValue({ kind: 'chatgpt', token });
  const request = vi.fn().mockResolvedValue(new Response('denied', { status: 401 }));
  vi.stubGlobal('fetch', request);
  expect(
    await new NodeCodexVerificationRuntime({ read }).run({
      ...input(),
      authMethod: 'cli',
      credentialKind: 'chatgpt',
      apiKey: undefined,
    })
  ).toBe('authentication');
  expect(request.mock.calls[0][1].headers['ChatGPT-Account-Id']).toBe('fixture-account');
});
it('propagates abort to the HTTP request and reports timeout', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('private fixture')), {
            once: true,
          });
        })
    )
  );
  const value = input();
  const pending = new NodeCodexVerificationRuntime({ read: vi.fn() }).run(value);
  value.controller.abort();
  expect(await pending).toBe('timeout');
});
