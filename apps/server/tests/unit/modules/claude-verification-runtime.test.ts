import { expect, it, vi, afterEach } from 'vitest';
import { NodeClaudeVerificationRuntime } from '../../../src/core/platform/claude-verification.runtime.js';
const sdk = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => sdk);
afterEach(() => vi.restoreAllMocks());

const input = () => ({
  cwd: '/backend',
  model: 'claude-sonnet-4-6' as const,
  environment: { PATH: '/owned/bin', ANTHROPIC_API_KEY: 'private' },
  controller: new AbortController(),
});
function stream(messages: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* messages;
    },
    close: vi.fn(),
  };
}
it('launches a no-tools/no-settings/nonpersistent query with per-call environment and closes it', async () => {
  const query = stream([{ type: 'result', subtype: 'success', is_error: false, result: 'ok' }]);
  sdk.query.mockReturnValue(query);
  const request = input();
  expect(await new NodeClaudeVerificationRuntime().run(request)).toBe('verified');
  expect(sdk.query.mock.calls[0][0].options).toMatchObject({
    cwd: '/backend',
    env: request.environment,
    tools: [],
    allowedTools: [],
    mcpServers: {},
    strictMcpConfig: true,
    persistSession: false,
    settingSources: [],
    maxTurns: 1,
  });
  expect(query.close).toHaveBeenCalledOnce();
});
it.each([
  [[{ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }], 'no-response'],
  [[{ type: 'result', subtype: 'error_max_turns', is_error: true }], 'failed'],
  [[{ type: 'result', subtype: 'success', is_error: true, result: 'ok' }], 'failed'],
  [
    [{ type: 'result', subtype: 'success', is_error: false, result: 'insufficient credits' }],
    'billing',
  ],
  [
    [{ type: 'result', subtype: 'success', is_error: false, result: 'rate limit reached' }],
    'rate-limit',
  ],
  [
    [{ type: 'result', subtype: 'success', is_error: false, result: 'authentication_error' }],
    'authentication',
  ],
  [[], 'no-response'],
  [
    [
      { type: 'system', billingMethod: 'api', rate_limit: 'allowed' },
      { type: 'result', subtype: 'success', is_error: false, result: 'ok' },
    ],
    'verified',
  ],
  [[{ type: 'result', subtype: 'success', result: 'ok' }], 'failed'],
  [Array.from({ length: 101 }, () => ({ type: 'system' })), 'failed'],
  [[{ type: 'system', data: 'x'.repeat(131073) }], 'failed'],
] as const)(
  'does not call partial/error/billing/rate-limit/oversized output verified (%#)',
  async (messages, expected) => {
    const query = stream([...messages]);
    sdk.query.mockReturnValue(query);
    expect(await new NodeClaudeVerificationRuntime().run(input())).toBe(expected);
    expect(query.close).toHaveBeenCalledOnce();
  }
);
it('closes a hung iterator on abort and does not wait for a late message to report timeout', async () => {
  const query = {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    close: vi.fn(),
  };
  sdk.query.mockReturnValue(query);
  const request = input();
  const pending = new NodeClaudeVerificationRuntime().run(request);
  request.controller.abort();
  expect(await pending).toBe('timeout');
  expect(query.close).toHaveBeenCalled();
});
