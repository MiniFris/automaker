import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ExecuteOptions,
  ProviderMessage,
  ResolvedOpenAICompatibleConnection,
} from '@automaker/types';
import { OpenAICompatibleProvider } from '@/providers/openai-compatible-provider.js';
import {
  chatCompletion,
  type ChatCompletionEvent,
  type ChatCompletionRequest,
} from '@/providers/openai-compatible/transport.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
interface CapturedRequest {
  path: string;
  authorization?: string;
  body: Record<string, unknown>;
}

const apiModel = 'Qwen/Qwen3-Coder:Latest';
const schema = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};

function jsonResponse(res: ServerResponse, text = 'Hello', finishReason = 'stop', extra = {}) {
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text, ...extra },
          finish_reason: finishReason,
        },
      ],
    })
  );
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return { choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

function frame(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

function outputText(messages: ProviderMessage[]) {
  return messages
    .flatMap((message) => message.message?.content ?? [])
    .map((block) => block.text ?? '')
    .join('');
}

function expectFailure(messages: ProviderMessage[], expected?: string) {
  expect(messages.filter((message) => message.type === 'error')).toHaveLength(1);
  expect(messages.at(-1)).toMatchObject({ type: 'result', subtype: 'error_during_execution' });
  expect(messages.some((message) => message.subtype === 'success')).toBe(false);
  if (expected)
    expect(messages.find((message) => message.type === 'error')?.error).toContain(expected);
}

describe('OpenAICompatibleProvider / local HTTP endpoint', () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;
  let requests: CapturedRequest[];
  let serverErrors: unknown[];
  let provider: OpenAICompatibleProvider;

  function connection(
    overrides: Partial<ResolvedOpenAICompatibleConnection> = {}
  ): ResolvedOpenAICompatibleConnection {
    return {
      endpointId: 'local-test',
      baseUrl,
      protocol: 'chat-completions',
      apiKey: 'test-secret-do-not-log',
      timeoutMs: 2000,
      maxRetries: 0,
      model: {
        id: apiModel,
        displayName: 'Coder',
        capabilities: { tools: true, streaming: false },
      },
      ...overrides,
    };
  }

  function options(overrides: Partial<ExecuteOptions> = {}): ExecuteOptions {
    return {
      model: apiModel,
      prompt: 'Hello',
      cwd: '/unused-worktree',
      tools: [],
      openaiCompatibleConnection: connection(),
      ...overrides,
    };
  }

  function streamingConnection(overrides: Partial<ResolvedOpenAICompatibleConnection> = {}) {
    return connection({
      model: { id: apiModel, displayName: 'Coder', capabilities: { tools: true, streaming: true } },
      ...overrides,
    });
  }

  function transportRequest(overrides: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest {
    return { messages: [{ role: 'user', content: 'Hello' }], stream: true, ...overrides };
  }

  beforeEach(async () => {
    requests = [];
    serverErrors = [];
    provider = new OpenAICompatibleProvider();
    handler = (_req, res) => jsonResponse(res);
    server = createServer((req, res) => {
      void (async () => {
        const buffers: Buffer[] = [];
        for await (const buffer of req) buffers.push(Buffer.from(buffer));
        requests.push({
          path: req.url!,
          authorization: req.headers.authorization,
          body: JSON.parse(Buffer.concat(buffers).toString()),
        });
        await handler(req, res);
      })().catch((error) => {
        serverErrors.push(error);
        if (!res.destroyed) {
          res.statusCode = 500;
          res.end();
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    baseUrl = `http://127.0.0.1:${address.port}/proxy/v1/`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    expect(serverErrors).toEqual([]);
  });

  it('sends exact model, API prefix, auth and explicit text history; no local context or secrets in the payload', async () => {
    const resolved = connection();
    resolved.model.maxOutputTokens = 512;
    const messages = await collect(
      provider.executeQuery(
        options({
          openaiCompatibleConnection: resolved,
          systemPrompt: 'System instruction',
          conversationHistory: [
            { role: 'user', content: 'Prior user' },
            { role: 'assistant', content: [{ type: 'text', text: 'Prior answer' }] },
          ],
          prompt: [{ type: 'text', text: 'New prompt' }],
          readOnly: true,
        })
      )
    );
    expect(outputText(messages)).toBe('Hello');
    expect(messages.at(-1)).toEqual({ type: 'result', subtype: 'success' });
    expect(requests).toEqual([
      {
        path: '/proxy/v1/chat/completions',
        authorization: 'Bearer test-secret-do-not-log',
        body: {
          model: apiModel,
          stream: false,
          max_completion_tokens: 512,
          messages: [
            { role: 'system', content: 'System instruction' },
            { role: 'user', content: 'Prior user' },
            { role: 'assistant', content: 'Prior answer' },
            { role: 'user', content: 'New prompt' },
          ],
        },
      },
    ]);
    expect(JSON.stringify(requests[0].body)).not.toContain('test-secret');
    expect(JSON.stringify(messages)).not.toContain('session_id');
  });

  it('does not add Authorization for a no-auth connection', async () => {
    const messages = await collect(
      provider.executeQuery(
        options({ openaiCompatibleConnection: connection({ apiKey: undefined }) })
      )
    );
    expect(messages.at(-1)?.subtype).toBe('success');
    expect(requests[0].authorization).toBeUndefined();
  });

  it('streams fragmented UTF-8, CRLF separators, comments and a usage-only trailer without duplicating text', async () => {
    handler = async (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      const bytes = Buffer.from(
        ': keepalive\r\n\r\n' +
          frame(chunk({ role: 'assistant', content: 'Привет' })).replaceAll('\n', '\r\n')
      );
      const unicodeIndex = bytes.indexOf(Buffer.from('Пр')) + 1;
      res.write(bytes.subarray(0, unicodeIndex));
      await delay(2);
      res.write(bytes.subarray(unicodeIndex, bytes.length - 1));
      await delay(2);
      res.write(bytes.subarray(bytes.length - 1));
      res.write(frame(chunk({ content: ' мир' })));
      res.write(frame(chunk({}, 'stop')));
      res.write(frame({ choices: [], usage: { completion_tokens: 2 } }));
      res.end('data: [DONE]\n\n');
    };
    const messages = await collect(
      provider.executeQuery(options({ openaiCompatibleConnection: streamingConnection() }))
    );
    expect(outputText(messages)).toBe('Привет мир');
    expect(messages.filter((message) => message.type === 'assistant')).toHaveLength(2);
    expect(messages.at(-1)).toEqual({ type: 'result', subtype: 'success' });
    expect(requests[0].body.stream).toBe(true);
  });

  it.each(['length', 'content_filter'])(
    'does not report finish_reason=%s as success',
    async (reason) => {
      handler = (_req, res) => jsonResponse(res, 'partial output', reason);
      const messages = await collect(provider.executeQuery(options()));
      expect(outputText(messages)).toBe('partial output');
      expectFailure(messages, reason === 'length' ? 'truncated' : 'filter');
    }
  );

  it('rejects refusals without echoing upstream refusal details', async () => {
    handler = (_req, res) =>
      jsonResponse(res, '', 'stop', { refusal: 'sensitive-upstream-detail' });
    const messages = await collect(provider.executeQuery(options()));
    expectFailure(messages, 'refused');
    expect(JSON.stringify(messages)).not.toContain('sensitive-upstream-detail');
  });

  it.each([401, 403, 400])('does not retry HTTP %i or expose the upstream body', async (status) => {
    handler = (_req, res) => {
      res.statusCode = status;
      res.end('test-secret-do-not-log sensitive-body');
    };
    const messages = await collect(
      provider.executeQuery(options({ openaiCompatibleConnection: connection({ maxRetries: 3 }) }))
    );
    expectFailure(messages, `HTTP ${status}`);
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(messages)).not.toMatch(/test-secret|sensitive-body/);
  });

  it('retries only explicit 429/5xx responses before producing output', async () => {
    handler = (_req, res) => {
      if (requests.length < 3) {
        res.statusCode = requests.length === 1 ? 429 : 503;
        res.setHeader('Retry-After', '0');
        res.end('ignored error body');
      } else jsonResponse(res);
    };
    const messages = await collect(
      provider.executeQuery(options({ openaiCompatibleConnection: connection({ maxRetries: 2 }) }))
    );
    expect(requests).toHaveLength(3);
    expect(outputText(messages)).toBe('Hello');
    expect(messages.at(-1)?.subtype).toBe('success');
  });

  it('stops at maxRetries and emits a sanitized HTTP error', async () => {
    handler = (_req, res) => {
      res.statusCode = 500;
      res.setHeader('Retry-After', '0');
      res.end('private');
    };
    const messages = await collect(
      provider.executeQuery(options({ openaiCompatibleConnection: connection({ maxRetries: 1 }) }))
    );
    expectFailure(messages, 'HTTP 500');
    expect(requests).toHaveLength(2);
  });

  it('does not shorten a long Retry-After or retry sooner than the endpoint asks', async () => {
    handler = (_req, res) => {
      res.statusCode = 429;
      res.setHeader('Retry-After', '120');
      res.end();
    };
    expectFailure(
      await collect(
        provider.executeQuery(
          options({ openaiCompatibleConnection: connection({ maxRetries: 3 }) })
        )
      ),
      'HTTP 429'
    );
    expect(requests).toHaveLength(1);
  });

  it('allows cancelling during retry backoff without sending the next request', async () => {
    let responseSent!: () => void;
    const sent = new Promise<void>((resolve) => {
      responseSent = resolve;
    });
    handler = (_req, res) => {
      res.on('finish', responseSent);
      res.statusCode = 429;
      res.setHeader('Retry-After', '5');
      res.end();
    };
    const abortController = new AbortController();
    const pending = collect(
      provider.executeQuery(
        options({ abortController, openaiCompatibleConnection: connection({ maxRetries: 3 }) })
      )
    );
    await sent;
    await delay(10);
    abortController.abort();
    expectFailure(await pending, 'cancelled');
    expect(requests).toHaveLength(1);
  });

  it('does not follow redirects or forward credentials to their target', async () => {
    handler = (_req, res) => {
      res.statusCode = 307;
      res.setHeader('Location', baseUrl + 'steal-key');
      res.end();
    };
    const messages = await collect(provider.executeQuery(options()));
    expectFailure(messages, 'HTTP 307');
    expect(requests).toHaveLength(1);
  });

  it.each([
    frame(chunk({ content: 'partial' })),
    frame(chunk({}, 'stop')),
    'data: [DONE]\n\n',
    frame(chunk({}, 'stop')) + 'data: [DONE]',
    'data: {invalid-sensitive-payload}\n\ndata: [DONE]\n\n',
    frame({ error: { message: 'sensitive-payload' } }) + 'data: [DONE]\n\n',
  ])('rejects malformed or incomplete streams without retrying (%#)', async (sse) => {
    handler = (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.end(sse);
    };
    const messages = await collect(
      provider.executeQuery(
        options({ openaiCompatibleConnection: streamingConnection({ maxRetries: 3 }) })
      )
    );
    expectFailure(messages, 'Invalid or incomplete');
    expect(JSON.stringify(messages)).not.toContain('sensitive-payload');
    expect(requests).toHaveLength(1);
  });

  it('does not replay a connection interrupted after the first model delta', async () => {
    handler = async (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(frame(chunk({ content: 'partial' })));
      await delay(10);
      res.destroy();
    };
    const messages = await collect(
      provider.executeQuery(
        options({ openaiCompatibleConnection: streamingConnection({ maxRetries: 3 }) })
      )
    );
    expect(outputText(messages)).toBe('partial');
    expectFailure(messages, 'interrupted');
    expect(requests).toHaveLength(1);
  });

  it('supports multiline SSE data and bare CR separators', async () => {
    handler = (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      const data = JSON.stringify(chunk({ content: 'OK' }));
      const position = data.indexOf('"delta"');
      res.end(
        'data: ' +
          data.slice(0, position) +
          '\rdata: ' +
          data.slice(position) +
          '\r\r' +
          frame(chunk({}, 'stop')) +
          'data: [DONE]\r\r'
      );
    };
    const messages = await collect(
      provider.executeQuery(options({ openaiCompatibleConnection: streamingConnection() }))
    );
    expect(outputText(messages)).toBe('OK');
    expect(messages.at(-1)?.subtype).toBe('success');
  });

  it('cancels before connecting without making a request', async () => {
    const abortController = new AbortController();
    abortController.abort('sensitive-abort-reason');
    const messages = await collect(provider.executeQuery(options({ abortController })));
    expectFailure(messages, 'cancelled');
    expect(JSON.stringify(messages)).not.toContain('sensitive-abort-reason');
    expect(requests).toHaveLength(0);
  });

  it('cancels an active response', async () => {
    handler = (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(frame(chunk({ content: 'partial' })));
    };
    const abortController = new AbortController();
    const stream = provider.executeQuery(
      options({ abortController, openaiCompatibleConnection: streamingConnection() })
    );
    const first = await stream.next();
    expect(first.value).toMatchObject({ type: 'assistant' });
    abortController.abort('sensitive-cause');
    const remaining = await collect(stream);
    expectFailure(remaining, 'cancelled');
    expect(JSON.stringify(remaining)).not.toContain('sensitive-cause');
  });

  it.each([false, true])('times out while waiting for %s (headers/body)', async (sendHeaders) => {
    handler = (_req, res) => {
      if (sendHeaders) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.flushHeaders();
      }
    };
    const messages = await collect(
      provider.executeQuery(
        options({ openaiCompatibleConnection: streamingConnection({ timeoutMs: 50 }) })
      )
    );
    expectFailure(messages, 'timed out');
    expect(requests).toHaveLength(1);
  });

  it('cancels the response when its consumer closes the async generator early', async () => {
    let responseClosed: Promise<unknown[]> | undefined;
    handler = (_req, res) => {
      responseClosed = once(res, 'close');
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(frame(chunk({ content: 'first' })));
    };
    const stream = provider.executeQuery(
      options({ openaiCompatibleConnection: streamingConnection() })
    );
    expect((await stream.next()).value).toMatchObject({ type: 'assistant' });
    await stream.return(undefined);
    await responseClosed;
    expect(requests).toHaveLength(1);
  });

  it('validates structured output locally and sends the explicit response_format', async () => {
    handler = (_req, res) => jsonResponse(res, '{"answer":"yes"}');
    const resolved = connection();
    resolved.model.capabilities.structuredOutput = true;
    const messages = await collect(
      provider.executeQuery(
        options({
          openaiCompatibleConnection: resolved,
          outputFormat: { type: 'json_schema', schema },
        })
      )
    );
    expect(messages.at(-1)).toEqual({
      type: 'result',
      subtype: 'success',
      structured_output: { answer: 'yes' },
    });
    expect(requests[0].body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'automaker_output', schema, strict: true },
    });
  });

  it.each(['{"answer":42}', '{"answer":"yes","extra":true}', 'not JSON', '[]'])(
    'rejects structured output that violates the schema (%#)',
    async (text) => {
      handler = (_req, res) => jsonResponse(res, text);
      const resolved = connection();
      resolved.model.capabilities.structuredOutput = true;
      const messages = await collect(
        provider.executeQuery(
          options({
            openaiCompatibleConnection: resolved,
            outputFormat: { type: 'json_schema', schema },
          })
        )
      );
      expectFailure(messages, 'did not match');
    }
  );

  it.each([
    { openaiCompatibleConnection: undefined },
    { model: 'different-model' },
    { tools: ['Unknown'] },
    { tools: ['Bash'] },
    { prompt: [{ type: 'image', source: {} }] },
    { systemPrompt: { type: 'preset', preset: 'claude_code' } },
    { sdkSessionId: 'unsupported-session' },
    { reasoningEffort: 'high' },
    { outputFormat: { type: 'json_schema', schema } },
    { mcpServers: { local: { command: 'must-not-run' } } },
  ] satisfies Partial<ExecuteOptions>[])(
    'rejects unsupported or unresolved requests before HTTP (%#)',
    async (overrides) => {
      expectFailure(await collect(provider.executeQuery(options(overrides))));
      expect(requests).toHaveLength(0);
    }
  );

  it('rejects an invalid JSON Schema before HTTP', async () => {
    const resolved = connection();
    resolved.model.capabilities.structuredOutput = true;
    expectFailure(
      await collect(
        provider.executeQuery(
          options({
            openaiCompatibleConnection: resolved,
            outputFormat: {
              type: 'json_schema',
              schema: { type: 'object', properties: { a: { type: 'not-a-type' } } },
            },
          })
        )
      ),
      'JSON Schema'
    );
    expect(requests).toHaveLength(0);
  });

  it('does not switch to another protocol when Responses is selected', async () => {
    expectFailure(
      await collect(
        provider.executeQuery(
          options({ openaiCompatibleConnection: connection({ protocol: 'responses' }) })
        )
      ),
      'Responses transport'
    );
    expect(requests).toHaveLength(0);
  });

  it('keeps concurrent endpoint credentials and responses isolated', async () => {
    handler = (req, res) =>
      jsonResponse(res, req.headers.authorization === 'Bearer endpoint-a' ? 'A' : 'B');
    const [a, b] = await Promise.all(
      ['endpoint-a', 'endpoint-b'].map((apiKey) =>
        collect(
          provider.executeQuery(
            options({ openaiCompatibleConnection: connection({ endpointId: apiKey, apiKey }) })
          )
        )
      )
    );
    expect(outputText(a)).toBe('A');
    expect(outputText(b)).toBe('B');
    expect(new Set(requests.map((request) => request.authorization))).toEqual(
      new Set(['Bearer endpoint-a', 'Bearer endpoint-b'])
    );
    expect(provider.getConfig()).toEqual({});
  });

  it('does not advertise CLI installation, authentication, tools or endpoint-specific models', async () => {
    expect(await provider.detectInstallation()).toEqual({
      installed: true,
      authenticated: false,
      hasApiKey: false,
      method: 'sdk',
    });
    expect(provider.getAvailableModels()).toEqual([]);
    expect(provider.supportsFeature('text')).toBe(true);
    expect(provider.supportsFeature('tools')).toBe(process.platform === 'linux');
    expect(provider.supportsFeature('mcp')).toBe(false);
  });

  it('aggregates interleaved tool-call deltas only after a complete terminal event', async () => {
    handler = (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(
        frame(
          chunk({
            tool_calls: [
              {
                index: 1,
                id: 'call-b',
                type: 'function',
                function: { name: 'Read', arguments: '{"path":' },
              },
              {
                index: 0,
                id: 'call-a',
                type: 'function',
                function: { name: 'LS', arguments: '{"path":"' },
              },
            ],
          })
        )
      );
      res.write(
        frame(
          chunk({
            tool_calls: [
              { index: 0, function: { arguments: '."}' } },
              { index: 1, function: { arguments: '"src/main.ts"}' } },
            ],
          })
        )
      );
      res.write(frame(chunk({}, 'tool_calls')));
      res.end('data: [DONE]\n\n');
    };
    const events = await collect(
      chatCompletion(
        streamingConnection(),
        transportRequest({
          tools: [{ type: 'function', function: { name: 'Read', parameters: { type: 'object' } } }],
        })
      )
    );
    expect(events).toEqual([
      {
        type: 'complete',
        completion: {
          text: '',
          finishReason: 'tool_calls',
          toolCalls: [
            { id: 'call-a', type: 'function', function: { name: 'LS', arguments: '{"path":"."}' } },
            {
              id: 'call-b',
              type: 'function',
              function: { name: 'Read', arguments: '{"path":"src/main.ts"}' },
            },
          ],
        },
      },
    ]);
    expect(requests[0].body.parallel_tool_calls).toBe(false);
  });

  it.each(['{"path":', 'null', '[]'])(
    'never releases incomplete/invalid tool arguments (%#)',
    async (args) => {
      handler = (_req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(
          frame(
            chunk({
              tool_calls: [
                {
                  index: 0,
                  id: 'call-a',
                  type: 'function',
                  function: { name: 'Read', arguments: args },
                },
              ],
            })
          )
        );
        res.write(frame(chunk({}, 'tool_calls')));
        res.end('data: [DONE]\n\n');
      };
      const events: ChatCompletionEvent[] = [];
      await expect(
        (async () => {
          for await (const event of chatCompletion(streamingConnection(), transportRequest()))
            events.push(event);
        })()
      ).rejects.toThrow('Invalid or incomplete');
      expect(events).toEqual([]);
    }
  );

  it('does not pretend to execute unsolicited model tools', async () => {
    handler = (_req, res) =>
      jsonResponse(res, '', 'tool_calls', {
        tool_calls: [
          {
            id: 'call-a',
            type: 'function',
            function: { name: 'Bash', arguments: '{"command":"must-not-run"}' },
          },
        ],
      });
    const messages = await collect(provider.executeQuery(options()));
    expectFailure(messages, 'requested tools');
    expect(
      messages
        .flatMap((message) => message.message?.content ?? [])
        .some((block) => block.type === 'tool_use')
    ).toBe(false);
  });

  it('reconstructs fragmented tool IDs and function names', async () => {
    handler = (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(
        frame(
          chunk({
            tool_calls: [
              { index: 0, id: 'call-', type: 'function', function: { name: 'Re', arguments: '{' } },
            ],
          })
        )
      );
      res.write(
        frame(
          chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'ad', arguments: '}' } }] })
        )
      );
      res.write(frame(chunk({}, 'tool_calls')));
      res.end('data: [DONE]\n\n');
    };
    const events = await collect(chatCompletion(streamingConnection(), transportRequest()));
    expect(events).toEqual([
      {
        type: 'complete',
        completion: {
          text: '',
          finishReason: 'tool_calls',
          toolCalls: [
            { id: 'call-a', type: 'function', function: { name: 'Read', arguments: '{}' } },
          ],
        },
      },
    ]);
  });

  it('discards truncated tool arguments instead of releasing executable calls', async () => {
    handler = (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(
        frame(
          chunk({
            tool_calls: [
              {
                index: 0,
                id: 'call-a',
                type: 'function',
                function: { name: 'Read', arguments: '{"path":' },
              },
            ],
          })
        )
      );
      res.write(frame(chunk({}, 'length')));
      res.end('data: [DONE]\n\n');
    };
    const events = await collect(chatCompletion(streamingConnection(), transportRequest()));
    expect(events).toEqual([
      { type: 'complete', completion: { text: '', finishReason: 'length', toolCalls: [] } },
    ]);
  });

  it('rejects duplicate tool call IDs rather than confusing tool results', async () => {
    handler = (_req, res) =>
      jsonResponse(res, '', 'tool_calls', {
        tool_calls: [
          { id: 'duplicate', type: 'function', function: { name: 'Read', arguments: '{}' } },
          { id: 'duplicate', type: 'function', function: { name: 'LS', arguments: '{}' } },
        ],
      });
    await expect(
      collect(chatCompletion(connection(), transportRequest({ stream: false })))
    ).rejects.toThrow('Invalid or incomplete');
  });

  it('rejects unexpected response content types without echoing the body', async () => {
    handler = (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('secret debug page');
    };
    const messages = await collect(provider.executeQuery(options()));
    expectFailure(messages, 'content type');
    expect(JSON.stringify(messages)).not.toContain('secret debug page');
  });

  it('rejects oversized SSE frames with bounded buffering', async () => {
    handler = (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.end('data: ' + 'x'.repeat(1024 * 1024 + 1) + '\n\n');
    };
    expectFailure(
      await collect(
        provider.executeQuery(options({ openaiCompatibleConnection: streamingConnection() }))
      ),
      'Invalid or incomplete'
    );
  });

  it('rejects oversized JSON bodies before parsing them', async () => {
    handler = (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(Buffer.alloc(16 * 1024 * 1024 + 1, 32));
    };
    expectFailure(await collect(provider.executeQuery(options())), 'Invalid or incomplete');
  });

  it.each([
    { choices: [] },
    {
      choices: [
        { index: 1, message: { role: 'assistant', content: 'bad' }, finish_reason: 'stop' },
      ],
    },
    {
      choices: [
        { index: 0, message: { role: 'assistant', content: 'bad' }, finish_reason: 'unknown' },
      ],
    },
  ])('rejects invalid non-streaming responses (%#)', async (response) => {
    handler = (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(response));
    };
    expectFailure(await collect(provider.executeQuery(options())), 'Invalid or incomplete');
  });

  it('rejects transport capability mismatches before making any requests', async () => {
    await expect(collect(chatCompletion(connection(), transportRequest()))).rejects.toThrow(
      'Streaming'
    );
    const noTools = streamingConnection();
    noTools.model.capabilities.tools = false;
    await expect(
      collect(
        chatCompletion(
          noTools,
          transportRequest({
            tools: [{ type: 'function', function: { name: 'Read', parameters: {} } }],
          })
        )
      )
    ).rejects.toThrow('Tool calling');
    await expect(
      collect(
        chatCompletion(
          connection(),
          transportRequest({
            stream: false,
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'output', schema, strict: true },
            },
          })
        )
      )
    ).rejects.toThrow('Structured output');
    expect(requests).toHaveLength(0);
  });

  it('sanitizes connection errors and does not replay them', async () => {
    expectFailure(
      await collect(
        provider.executeQuery(
          options({
            openaiCompatibleConnection: connection({
              baseUrl: 'http://127.0.0.1:0/private-secret-path/',
              maxRetries: 3,
            }),
          })
        )
      ),
      'Request failed'
    );
    expect(requests).toHaveLength(0);
  });
});
