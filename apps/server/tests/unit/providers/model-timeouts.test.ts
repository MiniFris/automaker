import { afterEach, expect, it, vi } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import type { ResolvedOpenAICompatibleConnection } from '@automaker/types';
import { chatCompletion } from '@/providers/openai-compatible/transport.js';
import { DirectSettingsCommandService } from '@/modules/settings/direct-settings-command.service.js';
import { agentLimits, AgentLoop } from '@/providers/openai-compatible/agent-loop.js';
import { ToolRegistry } from '@/providers/openai-compatible/tool-registry.js';
import {
  issueEnvironment,
  type ExecutionEnvironment,
} from '@/services/execution-environment/runtime.js';

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => {}) }));

const connection = (
  changes: Partial<ResolvedOpenAICompatibleConnection> = {}
): ResolvedOpenAICompatibleConnection => ({
  endpointId: 'fixture',
  baseUrl: 'http://127.0.0.1:1/v1/',
  protocol: 'chat-completions',
  model: { id: 'fixture', displayName: 'Fixture', capabilities: { streaming: false, tools: true } },
  timeoutMs: 90_000,
  maxRetries: 0,
  ...changes,
});
const request = { messages: [{ role: 'user' as const, content: 'hello' }], stream: false };
const response = () =>
  new Response(
    JSON.stringify({
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
async function collect(config: ResolvedOpenAICompatibleConnection) {
  const result = [];
  for await (const event of chatCompletion(config, request)) result.push(event);
  return result;
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('honours a response-header deadline above the former hidden 30-second cap', async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, options) =>
        new Promise((resolve, reject) => {
          signal = options.signal;
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          setTimeout(() => resolve(response()), 35_000);
        })
    )
  );
  let done = false;
  const pending = collect(connection({ timeouts: { responseHeadersTimeoutMs: 60_000 } })).then(
    (events) => {
      done = true;
      return events;
    }
  );
  await vi.advanceTimersByTimeAsync(30_001);
  expect(done).toBe(false);
  expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await pending).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'ok' })])
  );
  expect(vi.getTimerCount()).toBe(0);
});
it('retains the old header default and never retries an ambiguous timed-out request', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(
    (_url, options) =>
      new Promise((_resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      )
  );
  vi.stubGlobal('fetch', fetch);
  const pending = collect(connection({ maxRetries: 2 })).catch((error) => error.message);
  await vi.advanceTimersByTimeAsync(30_001);
  expect(await pending).toBe('OpenAI-compatible: Request timed out.');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('keeps the total request deadline authoritative even with a longer header timeout', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        )
    )
  );
  const pending = collect(
    connection({ timeoutMs: 1000, timeouts: { responseHeadersTimeoutMs: 60_000 } })
  ).catch((error) => error.message);
  await vi.advanceTimersByTimeAsync(1001);
  expect(await pending).toBe('OpenAI-compatible: Request timed out.');
});
it('uses the configured Retry-After budget without retrying before the server asks', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '10' } }))
    .mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetch);
  await collect(connection({ maxRetries: 1, timeouts: { retryAfterMaxMs: 15_000 } }));
  expect(delay).toHaveBeenCalledWith(10_000, undefined, { signal: undefined });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('uses an explicit discovery deadline independently of the ordinary generation timeout', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, options) =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
          setTimeout(() => resolve(new Response('{"data":[{"id":"model"}]}')), 40);
        })
    )
  );
  const service = new DirectSettingsCommandService(
    {
      getGlobalSettings: async () => ({
        modelTimeouts: { requestTimeoutMs: 10, modelDiscoveryTimeoutMs: 50 },
        openaiCompatibleEndpoints: [
          {
            id: 'fixture',
            name: 'Fixture',
            enabled: true,
            baseUrl: 'http://127.0.0.1:1/v1/',
            protocol: 'chat-completions',
            auth: { type: 'none' },
            models: [],
          },
        ],
      }),
      getCredentials: async () => ({}),
    } as never,
    {} as never
  );
  const pending = service.discoverModels({ providerId: 'fixture' }, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(40);
  expect(await pending).toEqual({ success: true, models: ['model'] });
});
it('allows longer agent/tool budgets without the old one-hour/ten-minute clamps', () => {
  expect(
    agentLimits({ maxDurationMs: 7_200_000, toolTimeoutMs: 900_000 }, undefined)
  ).toMatchObject({ maxDurationMs: 7_200_000, toolTimeoutMs: 900_000 });
});
it('forwards a tool budget into the actual environment shell instead of its shorter default', async () => {
  const exec = vi.fn(async () => ({ exitCode: 0, output: 'ok', truncated: false }));
  const environment = issueEnvironment({
    type: 'local',
    platform: 'linux',
    cwd: '/fixture',
    capabilities: { sandboxed: false },
    exec,
  } as unknown as ExecutionEnvironment);
  const registry = new ToolRegistry(environment, ['Bash'], false, undefined, 900_000);
  const signal = new AbortController().signal;
  await registry.execute(
    {
      id: 'tool',
      type: 'function',
      function: { name: 'Bash', arguments: '{"command":"echo ok"}' },
    },
    signal
  );
  expect(exec).toHaveBeenCalledWith('echo ok', signal, { cwd: undefined, timeoutMs: 900_000 });
});
it('uses the checkpoint deadline before dispatching a model request', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const loop = new AgentLoop({
    connection: connection({ timeouts: { checkpointTimeoutMs: 10 } }),
    request,
    workspace: '/fixture',
    agent: { onCheckpoint: () => new Promise(() => {}) },
  });
  const pending = loop
    .run()
    .next()
    .catch((error) => error.message);
  await vi.advanceTimersByTimeAsync(25);
  expect(await pending).toBe('OpenAI-compatible: Agent checkpoint could not be saved.');
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
