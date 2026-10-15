import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DirectAgentCheckpoint,
  ExecuteOptions,
  ProviderMessage,
  ResolvedOpenAICompatibleConnection,
} from '@automaker/types';
import { OpenAICompatibleProvider } from '@/providers/openai-compatible-provider.js';
import { ToolRegistry } from '@/providers/openai-compatible/tool-registry.js';
import { textHash } from '@/providers/openai-compatible/workspace.js';
import { ReadOnlyWorkspace } from '@/providers/openai-compatible/workspace.js';
import { AgentCheckpointStore, parseCheckpoint } from '@/providers/openai-compatible/checkpoint.js';
import type {
  ChatCompletionRequest,
  ChatToolCall,
} from '@/providers/openai-compatible/transport.js';

function finish(res: ServerResponse, text = 'Finished') {
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    })
  );
}
function tool(name: string, args: unknown, id: string): ChatToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}
function calls(res: ServerResponse, toolCalls: ChatToolCall[]) {
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: null, tool_calls: toolCalls },
          finish_reason: 'tool_calls',
        },
      ],
    })
  );
}
async function collect(stream: AsyncIterable<ProviderMessage>) {
  const messages: ProviderMessage[] = [];
  for await (const message of stream) messages.push(message);
  return messages;
}
function blocks(messages: ProviderMessage[]) {
  return messages.flatMap((message) => message.message?.content ?? []);
}
function failure(messages: ProviderMessage[], text: string) {
  expect(messages.some((message) => message.subtype === 'success')).toBe(false);
  expect(messages.filter((message) => message.type === 'error')).toHaveLength(1);
  expect(messages.find((message) => message.type === 'error')?.error).toContain(text);
}

describe.skipIf(process.platform !== 'linux')(
  'direct agent loop / local endpoint and workspace',
  () => {
    let fixture: string;
    let root: string;
    let server: Server;
    let baseUrl: string;
    let requests: ChatCompletionRequest[];
    let handler: (request: ChatCompletionRequest, res: ServerResponse) => void | Promise<void>;
    let serverErrors: unknown[];
    let snapshots: DirectAgentCheckpoint[];
    let provider: OpenAICompatibleProvider;

    function connection(): ResolvedOpenAICompatibleConnection {
      return {
        endpointId: 'test-endpoint',
        baseUrl,
        protocol: 'chat-completions',
        apiKey: 'agent-api-secret',
        timeoutMs: 2000,
        maxRetries: 0,
        model: {
          id: 'Vendor/Coder:latest',
          displayName: 'Coder',
          capabilities: { tools: true, streaming: false },
        },
      };
    }
    function options(overrides: Partial<ExecuteOptions> = {}): ExecuteOptions {
      return {
        openaiCompatibleConnection: connection(),
        model: 'Vendor/Coder:latest',
        prompt: 'Find and explain the answer',
        cwd: root,
        readOnly: true,
        openaiCompatibleAgent: {
          onCheckpoint: (snapshot) => {
            snapshots.push(snapshot);
          },
        },
        ...overrides,
      };
    }

    beforeEach(async () => {
      fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'direct-agent-test-'));
      root = path.join(fixture, 'project');
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const answer = 42;');
      snapshots = [];
      requests = [];
      serverErrors = [];
      provider = new OpenAICompatibleProvider();
      handler = (_request, res) => finish(res);
      server = createServer((req, res) => {
        void (async () => {
          const buffers: Buffer[] = [];
          for await (const buffer of req) buffers.push(Buffer.from(buffer));
          const request: ChatCompletionRequest = JSON.parse(Buffer.concat(buffers).toString());
          requests.push(request);
          await handler(request, res);
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
      if (!address || typeof address === 'string') throw new Error('Missing address');
      baseUrl = `http://127.0.0.1:${address.port}/v1/`;
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
      await fs.rm(fixture, { recursive: true, force: true });
      expect(serverErrors).toEqual([]);
    });

    it('completes find → read → answer and preserves exact call/result IDs in history and events', async () => {
      handler = (request, res) => {
        if (requests.length === 1) {
          expect(request.tools?.map((item) => item.function.name)).toEqual([
            'Read',
            'LS',
            'Glob',
            'Grep',
          ]);
          calls(res, [tool('Glob', { pattern: '**/*.ts' }, 'find')]);
        } else if (requests.length === 2) {
          expect(request.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'find' });
          expect(JSON.parse(request.messages.at(-1)!.content!).result.files).toEqual([
            'src/main.ts',
          ]);
          calls(res, [tool('Read', { path: 'src/main.ts' }, 'read')]);
        } else {
          expect(JSON.parse(request.messages.at(-1)!.content!).result.content).toContain('42');
          finish(res, 'The answer is 42.');
        }
      };
      const messages = await collect(provider.executeQuery(options()));
      expect(messages.at(-1)).toEqual({ type: 'result', subtype: 'success' });
      expect(
        blocks(messages)
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('')
      ).toBe('The answer is 42.');
      expect(
        blocks(messages)
          .filter((block) => block.type === 'tool_use')
          .map((block) => block.tool_use_id)
      ).toEqual(['find', 'read']);
      expect(
        blocks(messages)
          .filter((block) => block.type === 'tool_result')
          .map((block) => block.tool_use_id)
      ).toEqual(['find', 'read']);
      expect(snapshots.at(-1)).toMatchObject({ status: 'completed', turns: 3, toolCalls: 2 });
      expect(parseCheckpoint(snapshots.at(-1))).toEqual(snapshots.at(-1));
      expect(JSON.stringify(snapshots)).not.toContain('agent-api-secret');
    });

    it.each([
      ['Bash', { command: 'must-not-run' }, 'UNKNOWN_TOOL'],
      ['Read', { path: 42 }, 'INVALID_ARGUMENTS'],
      ['Read', { path: 'src/main.ts', extra: 'sensitive-value' }, 'INVALID_ARGUMENTS'],
    ])('returns safe errors for %s and lets the model recover', async (name, args, code) => {
      handler = (request, res) => {
        if (requests.length === 1) calls(res, [tool(name as string, args, 'invalid')]);
        else {
          expect(JSON.parse(request.messages.at(-1)!.content!)).toMatchObject({
            ok: false,
            error: { code },
          });
          expect(request.messages.at(-1)!.content).not.toContain('sensitive-value');
          finish(res, 'Recovered');
        }
      };
      const read = vi.spyOn(ReadOnlyWorkspace.prototype, 'read');
      const messages = await collect(provider.executeQuery(options()));
      expect(messages.at(-1)?.subtype).toBe('success');
      expect(read).not.toHaveBeenCalled();
      expect(blocks(messages).filter((block) => block.type === 'tool_result')).toHaveLength(1);
    });

    it('executes a multi-tool response sequentially and sends all results before the next model call', async () => {
      const original = ToolRegistry.prototype.execute;
      let active = 0,
        peak = 0;
      vi.spyOn(ToolRegistry.prototype, 'execute').mockImplementation(async function (
        this: ToolRegistry,
        ...args: Parameters<ToolRegistry['execute']>
      ) {
        active++;
        peak = Math.max(peak, active);
        try {
          await delay(2);
          return await original.apply(this, args);
        } finally {
          active--;
        }
      });
      handler = (request, res) => {
        if (requests.length === 1)
          calls(res, [tool('LS', {}, 'ls'), tool('Read', { path: 'src/main.ts' }, 'read')]);
        else {
          expect(
            request.messages
              .filter((message) => message.role === 'tool')
              .map((message) => message.tool_call_id)
          ).toEqual(['ls', 'read']);
          finish(res);
        }
      };
      expect((await collect(provider.executeQuery(options()))).at(-1)?.subtype).toBe('success');
      expect(peak).toBe(1);
    });

    it('does not execute tools when maxTurns leaves no room for a follow-up answer', async () => {
      handler = (_request, res) => calls(res, [tool('Read', { path: 'src/main.ts' }, 'read')]);
      const read = vi.spyOn(ReadOnlyWorkspace.prototype, 'read');
      const messages = await collect(provider.executeQuery(options({ maxTurns: 1 })));
      failure(messages, 'maxTurns');
      expect(messages.at(-1)?.subtype).toBe('error_max_turns');
      expect(read).not.toHaveBeenCalled();
      expect(requests).toHaveLength(1);
    });

    it('rejects a batch exceeding the tool-call budget without executing part of it', async () => {
      handler = (_request, res) =>
        calls(res, [tool('LS', {}, 'a'), tool('LS', { path: 'src' }, 'b')]);
      const execute = vi.spyOn(ToolRegistry.prototype, 'execute');
      const messages = await collect(
        provider.executeQuery(options({ openaiCompatibleAgent: { limits: { maxToolCalls: 1 } } }))
      );
      failure(messages, 'tool-call budget');
      expect(execute).not.toHaveBeenCalled();
    });

    it('detects identical repeated calls despite JSON key reordering', async () => {
      handler = (_request, res) =>
        calls(res, [
          tool(
            'Read',
            requests.length === 1
              ? { path: 'src/main.ts', maxLines: 5 }
              : { maxLines: 5, path: 'src/main.ts' },
            `read-${requests.length}`
          ),
        ]);
      const execute = vi.spyOn(ToolRegistry.prototype, 'execute');
      const messages = await collect(
        provider.executeQuery(
          options({ openaiCompatibleAgent: { limits: { maxRepeatedCalls: 1 } } })
        )
      );
      failure(messages, 'Repeated identical');
      expect(execute).toHaveBeenCalledTimes(1);
      expect(requests).toHaveLength(2);
    });

    it('rejects reused call IDs rather than executing the same ID twice', async () => {
      handler = (_request, res) =>
        calls(res, [tool('LS', requests.length === 1 ? {} : { path: 'src' }, 'same-id')]);
      const execute = vi.spyOn(ToolRegistry.prototype, 'execute');
      failure(await collect(provider.executeQuery(options())), 'reused');
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it('applies the total context guard before HTTP', async () => {
      const resolved = connection();
      resolved.model.contextWindow = 64;
      failure(
        await collect(
          provider.executeQuery(options({ tools: [], openaiCompatibleConnection: resolved }))
        ),
        'context budget'
      );
      expect(requests).toHaveLength(0);
    });

    it('stops when tool output exhausts context, without dropping tool/result pairs or replaying HTTP', async () => {
      await fs.writeFile(path.join(root, 'large.txt'), 'x'.repeat(4000));
      handler = (_request, res) => calls(res, [tool('Read', { path: 'large.txt' }, 'read')]);
      const messages = await collect(
        provider.executeQuery(
          options({
            tools: ['Read'],
            openaiCompatibleAgent: {
              limits: { maxContextBytes: 2500 },
              onCheckpoint: (snapshot) => {
                snapshots.push(snapshot);
              },
            },
          })
        )
      );
      failure(messages, 'context budget');
      expect(requests).toHaveLength(1);
      expect(snapshots.at(-1)?.toolCalls).toBe(1);
      expect(parseCheckpoint(snapshots.at(-1)).messages.at(-1)?.role).toBe('tool');
    });

    it('limits accumulated model output instead of reporting oversized output as success', async () => {
      handler = (_request, res) => finish(res, 'long answer');
      failure(
        await collect(
          provider.executeQuery(
            options({ openaiCompatibleAgent: { limits: { maxOutputChars: 4 } } })
          )
        ),
        'output budget'
      );
      expect(requests).toHaveLength(1);
    });

    it('enforces a total run deadline while the endpoint is silent', async () => {
      handler = () => {};
      const messages = await collect(
        provider.executeQuery(
          options({
            openaiCompatibleAgent: {
              limits: { maxDurationMs: 40 },
              onCheckpoint: (snapshot) => {
                snapshots.push(snapshot);
              },
            },
          })
        )
      );
      failure(messages, 'cancelled');
      expect(snapshots.at(-1)?.status).toBe('interrupted');
    });

    it('enforces a tool deadline and emits a paired interrupted result before the error', async () => {
      handler = (_request, res) => calls(res, [tool('Read', { path: 'src/main.ts' }, 'hung')]);
      vi.spyOn(ToolRegistry.prototype, 'execute').mockImplementation(() => new Promise(() => {}));
      const messages = await collect(
        provider.executeQuery(
          options({
            openaiCompatibleAgent: {
              limits: { toolTimeoutMs: 30 },
              onCheckpoint: (snapshot) => {
                snapshots.push(snapshot);
              },
            },
          })
        )
      );
      failure(messages, 'cancelled');
      expect(blocks(messages).filter((block) => block.type === 'tool_result')).toMatchObject([
        { tool_use_id: 'hung' },
      ]);
      expect(parseCheckpoint(snapshots.at(-1)).messages.at(-1)?.tool_call_id).toBe('hung');
    });

    it('cancels after tool_use before filesystem access and saves a balanced checkpoint', async () => {
      handler = (_request, res) => calls(res, [tool('Read', { path: 'src/main.ts' }, 'cancelled')]);
      const controller = new AbortController();
      const read = vi.spyOn(ReadOnlyWorkspace.prototype, 'read');
      const stream = provider.executeQuery(options({ abortController: controller }));
      expect((await stream.next()).value).toMatchObject({
        type: 'assistant',
        message: { content: [{ type: 'tool_use' }] },
      });
      controller.abort('private-reason');
      const messages = await collect(stream);
      failure(messages, 'cancelled');
      expect(read).not.toHaveBeenCalled();
      expect(JSON.stringify(messages)).not.toContain('private-reason');
      expect(parseCheckpoint(snapshots.at(-1)).status).toBe('interrupted');
    });

    it('closing the generator early does not execute pending tools or leave unbalanced saved history', async () => {
      handler = (_request, res) =>
        calls(res, [tool('LS', {}, 'a'), tool('Read', { path: 'src/main.ts' }, 'b')]);
      const execute = vi.spyOn(ToolRegistry.prototype, 'execute');
      const stream = provider.executeQuery(options());
      await stream.next();
      await stream.return(undefined);
      expect(execute).not.toHaveBeenCalled();
      const checkpoint = parseCheckpoint(snapshots.at(-1));
      expect(checkpoint.status).toBe('interrupted');
      expect(checkpoint.toolCalls).toBe(2);
      expect(checkpoint.messages.filter((message) => message.role === 'tool')).toHaveLength(2);
    });

    it('resumes from a completed tool boundary, without repeating a read or resetting budgets', async () => {
      handler = (_request, res) =>
        requests.length === 1
          ? calls(res, [tool('Read', { path: 'src/main.ts' }, 'read')])
          : finish(res, 'Resumed');
      const read = vi.spyOn(ReadOnlyWorkspace.prototype, 'read');
      const originalOptions = options();
      const stream = provider.executeQuery(originalOptions);
      await stream.next(); // tool_use
      await stream.next(); // tool_result
      await stream.return(undefined);
      const checkpoint = snapshots.at(-1)!;
      expect(checkpoint.turns).toBe(1);
      const messages = await collect(
        provider.executeQuery({
          ...originalOptions,
          openaiCompatibleAgent: {
            checkpoint,
            onCheckpoint: (snapshot) => {
              snapshots.push(snapshot);
            },
          },
        })
      );
      expect(messages.at(-1)?.subtype).toBe('success');
      expect(read).toHaveBeenCalledTimes(1);
      expect(snapshots.at(-1)).toMatchObject({
        sessionId: checkpoint.sessionId,
        turns: 2,
        toolCalls: 1,
        status: 'completed',
      });
      expect(snapshots.at(-1)!.elapsedMs).toBeGreaterThanOrEqual(checkpoint.elapsedMs);
    });

    it('rejects a mismatched or already completed checkpoint before HTTP', async () => {
      await collect(provider.executeQuery(options()));
      const checkpoint = snapshots.at(-1)!;
      const count = requests.length;
      failure(
        await collect(provider.executeQuery(options({ openaiCompatibleAgent: { checkpoint } }))),
        'already completed'
      );
      failure(
        await collect(
          provider.executeQuery(
            options({
              prompt: 'different request',
              openaiCompatibleAgent: { checkpoint: { ...checkpoint, status: 'interrupted' } },
            })
          )
        ),
        'does not match'
      );
      expect(requests).toHaveLength(count);
    });

    it('restores a persisted tool boundary in a new provider instance without replaying tools', async () => {
      const store = new AgentCheckpointStore(path.join(fixture, 'data'));
      let sessionId = '';
      const baseOptions = options({
        openaiCompatibleAgent: {
          onCheckpoint: async (snapshot) => {
            sessionId = snapshot.sessionId;
            await store.save(snapshot);
          },
        },
      });
      handler = (_request, res) =>
        requests.length === 1
          ? calls(res, [tool('Read', { path: 'src/main.ts' }, 'persisted-read')])
          : finish(res);
      const read = vi.spyOn(ReadOnlyWorkspace.prototype, 'read');
      const stream = provider.executeQuery(baseOptions);
      await stream.next();
      await stream.next();
      await stream.return(undefined);
      const checkpoint = await store.load(sessionId);
      const restored = new OpenAICompatibleProvider();
      const messages = await collect(
        restored.executeQuery({
          ...baseOptions,
          openaiCompatibleAgent: { checkpoint, onCheckpoint: (snapshot) => store.save(snapshot) },
        })
      );
      expect(messages.at(-1)?.subtype).toBe('success');
      expect(read).toHaveBeenCalledTimes(1);
      expect((await store.load(sessionId)).turns).toBe(2);
    });

    it.each(['endpoint', 'model', 'workspace', 'tools', 'url'])(
      'rejects checkpoint reuse after changing %s',
      async (change) => {
        handler = (_request, res) => calls(res, [tool('LS', {}, 'ls')]);
        const stream = provider.executeQuery(options());
        await stream.next();
        await stream.return(undefined);
        const checkpoint = snapshots.at(-1)!;
        const overrides: Partial<ExecuteOptions> = { openaiCompatibleAgent: { checkpoint } };
        const resolved = connection();
        if (change === 'endpoint') resolved.endpointId = 'other-endpoint';
        if (change === 'model') {
          resolved.model.id = 'other-model';
          overrides.model = 'other-model';
        }
        if (change === 'url') resolved.baseUrl = baseUrl + 'other/';
        if (change === 'tools') overrides.tools = ['Read'];
        if (change === 'workspace') {
          overrides.cwd = path.join(fixture, 'other-project');
          await fs.mkdir(overrides.cwd);
        }
        overrides.openaiCompatibleConnection = resolved;
        failure(await collect(provider.executeQuery(options(overrides))), 'does not match');
        expect(requests).toHaveLength(1);
      }
    );

    it('keeps the consumed duration budget when restoring a checkpoint', async () => {
      handler = (_request, res) => calls(res, [tool('LS', {}, 'ls')]);
      const stream = provider.executeQuery(options());
      await stream.next();
      await stream.return(undefined);
      const checkpoint = { ...snapshots.at(-1)!, elapsedMs: 1000 };
      failure(
        await collect(
          provider.executeQuery(
            options({ openaiCompatibleAgent: { checkpoint, limits: { maxDurationMs: 100 } } })
          )
        ),
        'duration budget'
      );
      expect(requests).toHaveLength(1);
    });

    it('does not request tools from a model whose tool capability is disabled', async () => {
      const resolved = connection();
      resolved.model.capabilities.tools = false;
      failure(
        await collect(provider.executeQuery(options({ openaiCompatibleConnection: resolved }))),
        'Tool calling is not enabled'
      );
      expect(requests).toHaveLength(0);
    });

    it('does not reset maxTurns when resuming an interrupted request', async () => {
      handler = (_request, res) => calls(res, [tool('LS', {}, 'ls')]);
      const stream = provider.executeQuery(options());
      await stream.next();
      await stream.return(undefined);
      const checkpoint = snapshots.at(-1)!;
      const count = requests.length;
      const messages = await collect(
        provider.executeQuery(options({ maxTurns: 1, openaiCompatibleAgent: { checkpoint } }))
      );
      failure(messages, 'maxTurns');
      expect(requests).toHaveLength(count);
    });

    it('provides detached snapshots so callbacks cannot mutate the live conversation', async () => {
      const messages = await collect(
        provider.executeQuery(
          options({
            openaiCompatibleAgent: {
              onCheckpoint: (snapshot) => {
                snapshot.messages[0].content = 'tampered';
                snapshot.turns = 99;
              },
            },
          })
        )
      );
      expect(messages.at(-1)?.subtype).toBe('success');
      expect(requests[0].messages[0].content).toBe('Find and explain the answer');
    });

    it('isolates parallel sessions sharing the same provider instance', async () => {
      handler = (request, res) => finish(res, request.messages[0].content!);
      const a: DirectAgentCheckpoint[] = [],
        b: DirectAgentCheckpoint[] = [];
      const results = await Promise.all([
        collect(
          provider.executeQuery(
            options({
              prompt: 'A',
              openaiCompatibleAgent: {
                onCheckpoint: (snapshot) => {
                  a.push(snapshot);
                },
              },
            })
          )
        ),
        collect(
          provider.executeQuery(
            options({
              prompt: 'B',
              openaiCompatibleAgent: {
                onCheckpoint: (snapshot) => {
                  b.push(snapshot);
                },
              },
            })
          )
        ),
      ]);
      expect(results.every((messages) => messages.at(-1)?.subtype === 'success')).toBe(true);
      expect(a.at(-1)?.sessionId).not.toBe(b.at(-1)?.sessionId);
      expect(JSON.stringify(a)).not.toContain('"content":"B"');
      expect(JSON.stringify(b)).not.toContain('"content":"A"');
    });

    it('performs Read → Edit → TodoWrite → answer with explicitly granted write authority', async () => {
      handler = (request, res) => {
        if (requests.length === 1) calls(res, [tool('Read', { path: 'src/main.ts' }, 'read-edit')]);
        else if (requests.length === 2) {
          const read = JSON.parse(request.messages.at(-1)!.content!).result;
          calls(res, [
            tool(
              'Edit',
              { path: 'src/main.ts', oldText: '42', newText: '43', expectedSha256: read.sha256 },
              'edit'
            ),
          ]);
        } else if (requests.length === 3) {
          expect(JSON.parse(request.messages.at(-1)!.content!).ok).toBe(true);
          calls(res, [
            tool(
              'TodoWrite',
              { todos: [{ content: 'Update answer', status: 'completed' }] },
              'todo'
            ),
          ]);
        } else finish(res, 'Updated to 43');
      };
      const result = await collect(
        provider.executeQuery(
          options({
            readOnly: false,
            tools: ['Read', 'Edit', 'TodoWrite'],
            openaiCompatibleAgent: {
              access: 'workspace-write',
              onCheckpoint: (snapshot) => {
                snapshots.push(snapshot);
              },
            },
          })
        )
      );
      expect(result.at(-1)?.subtype).toBe('success');
      expect(await fs.readFile(path.join(root, 'src/main.ts'), 'utf8')).toContain('43');
      expect(
        snapshots.some(
          (snapshot) =>
            snapshot.status === 'interrupted' &&
            snapshot.messages.at(-1)?.content?.includes('INTERRUPTED')
        )
      ).toBe(true);
      expect(snapshots.at(-1)?.messages.at(-2)?.content).toContain('completed');
    });

    it('saves an unknown-result intent before executing a write and does not write if it cannot be persisted', async () => {
      handler = (_request, res) =>
        calls(res, [
          tool(
            'Write',
            { path: 'new.txt', content: 'must-not-write', expectedSha256: null },
            'intent'
          ),
        ]);
      const result = await collect(
        provider.executeQuery(
          options({
            readOnly: false,
            tools: ['Write'],
            openaiCompatibleAgent: {
              access: 'workspace-write',
              onCheckpoint: (snapshot) => {
                if (snapshot.toolCalls) throw new Error('store-failure');
              },
            },
          })
        )
      );
      failure(result, 'checkpoint could not be saved');
      await expect(fs.stat(path.join(root, 'new.txt'))).rejects.toThrow();
      expect(requests).toHaveLength(1);
    });

    it('binds checkpoints to the effective access policy even when the tool list is unchanged', async () => {
      await collect(provider.executeQuery(options()));
      const checkpoint = { ...snapshots.at(-1)!, status: 'interrupted' as const };
      const previous = requests.length;
      failure(
        await collect(
          provider.executeQuery(
            options({
              readOnly: false,
              openaiCompatibleAgent: { access: 'workspace-write', checkpoint },
              tools: ['Read', 'LS', 'Glob', 'Grep'],
            })
          )
        ),
        'Checkpoint does not match'
      );
      expect(requests).toHaveLength(previous);
    });

    it('readOnly:true restricts a requested write profile before contacting the endpoint', async () => {
      failure(
        await collect(
          provider.executeQuery(
            options({
              tools: ['Write'],
              openaiCompatibleAgent: { access: 'workspace-write' },
            })
          )
        ),
        'unavailable'
      );
      expect(requests).toHaveLength(0);
    });

    it('pairs and checkpoints write results before returning to the model', async () => {
      handler = (request, res) => {
        if (requests.length === 1)
          calls(res, [
            tool(
              'Write',
              {
                path: 'src/main.ts',
                content: 'replacement',
                expectedSha256: textHash('export const answer = 42;'),
              },
              'write-pair'
            ),
          ]);
        else {
          const pair = request.messages.slice(-2);
          expect(pair[0].tool_calls?.[0].id).toBe('write-pair');
          expect(pair[1].tool_call_id).toBe('write-pair');
          finish(res);
        }
      };
      const result = await collect(
        provider.executeQuery(
          options({
            readOnly: false,
            tools: ['Write'],
            openaiCompatibleAgent: { access: 'workspace-write' },
          })
        )
      );
      expect(result.at(-1)?.subtype).toBe('success');
      expect(await fs.readFile(path.join(root, 'src/main.ts'), 'utf8')).toBe('replacement');
    });

    it.skipIf(!process.env.DIRECT_AGENT_DOCKER_TEST_IMAGE)(
      'runs a complete model-driven coding task and shell test in a Git worktree',
      async () => {
        const exec = promisify(execFile);
        await fs.writeFile(path.join(root, 'test.sh'), 'grep -q "answer = 43;" src/main.ts');
        await exec('git', ['init', root]);
        await exec('git', ['-C', root, 'add', '.']);
        await exec('git', [
          '-C',
          root,
          '-c',
          'user.name=Direct Test',
          '-c',
          'user.email=direct@test.invalid',
          'commit',
          '-m',
          'fixture',
        ]);
        const worktree = path.join(fixture, 'coding-worktree');
        await exec('git', ['-C', root, 'worktree', 'add', '--detach', worktree]);
        handler = (request, res) => {
          if (requests.length === 1)
            calls(res, [tool('Read', { path: 'src/main.ts' }, 'coding-read')]);
          else if (requests.length === 2)
            calls(res, [
              tool(
                'Edit',
                {
                  path: 'src/main.ts',
                  oldText: '42',
                  newText: '43',
                  expectedSha256: JSON.parse(request.messages.at(-1)!.content!).result.sha256,
                },
                'coding-edit'
              ),
            ]);
          else if (requests.length === 3)
            calls(res, [tool('Bash', { command: 'sh test.sh && echo verified' }, 'coding-test')]);
          else {
            const tested = JSON.parse(request.messages.at(-1)!.content!);
            expect(tested).toMatchObject({
              ok: true,
              result: { exitCode: 0, output: 'verified\n' },
            });
            finish(res, 'Changed and verified');
          }
        };
        const result = await collect(
          provider.executeQuery(
            options({
              cwd: worktree,
              readOnly: false,
              openaiCompatibleAgent: {
                access: 'workspace-write',
                shell: { backend: 'docker', image: process.env.DIRECT_AGENT_DOCKER_TEST_IMAGE! },
              },
            })
          )
        );
        expect(result.at(-1)?.subtype).toBe('success');
        const diff = await exec('git', ['-C', worktree, 'diff', '--', 'src/main.ts']);
        expect(diff.stdout).toContain('+export const answer = 43;');
        expect(await fs.readFile(path.join(root, 'src/main.ts'), 'utf8')).toContain('42');
      },
      20_000
    );

    it.skipIf(!process.env.DIRECT_AGENT_DOCKER_TEST_IMAGE)(
      'waits for container cleanup after the agent tool deadline',
      async () => {
        handler = (_request, res) =>
          calls(res, [
            tool(
              'Bash',
              { command: 'printf bad > src/main.ts; (sleep 120 &) ; sleep 120' },
              'timeout-container'
            ),
          ]);
        const result = await collect(
          provider.executeQuery(
            options({
              readOnly: false,
              tools: ['Bash'],
              openaiCompatibleAgent: {
                access: 'workspace-write',
                shell: { backend: 'docker', image: process.env.DIRECT_AGENT_DOCKER_TEST_IMAGE! },
                limits: { toolTimeoutMs: 700 },
                onCheckpoint: (snapshot) => {
                  snapshots.push(snapshot);
                },
              },
            })
          )
        );
        failure(result, 'cancelled or timed out');
        expect(requests).toHaveLength(1);
        expect(await fs.readFile(path.join(root, 'src/main.ts'), 'utf8')).toBe(
          'export const answer = 42;'
        );
        expect(snapshots.at(-1)?.messages.at(-1)?.content).toContain('INTERRUPTED');
        // Inspect only containers created by this implementation, never unrelated user containers.
        const containers = await promisify(execFile)('/usr/bin/docker', [
          'ps',
          '-aq',
          '--filter',
          `label=automaker.direct.workspace=${textHash(root)}`,
        ]);
        expect(containers.stdout.trim()).toBe('');
      },
      20_000
    );

    it('persists checkpoints outside the workspace with private permissions and reloads them', async () => {
      const store = new AgentCheckpointStore(path.join(fixture, 'data'));
      let savedId = '';
      const messages = await collect(
        provider.executeQuery(
          options({
            openaiCompatibleAgent: {
              onCheckpoint: async (snapshot) => {
                savedId = snapshot.sessionId;
                await store.save(snapshot);
              },
            },
          })
        )
      );
      expect(messages.at(-1)?.subtype).toBe('success');
      expect((await store.load(savedId)).status).toBe('completed');
      const file = path.join(fixture, 'data', 'direct-agent-checkpoints', `${savedId}.json`);
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
      expect(await fs.readFile(file, 'utf8')).not.toContain('agent-api-secret');
      await expect(store.load('../../escape')).rejects.toThrow('Invalid checkpoint session ID');
    });

    it('fails explicitly if checkpoint persistence fails, without claiming completion', async () => {
      failure(
        await collect(
          provider.executeQuery(
            options({
              openaiCompatibleAgent: {
                onCheckpoint: () => {
                  throw new Error('sensitive-store-path');
                },
              },
            })
          )
        ),
        'checkpoint could not be saved'
      );
      expect(requests).toHaveLength(0);
    });

    it.each([0, -1, 101, 1.5])('rejects invalid maxTurns=%s before HTTP', async (maxTurns) => {
      failure(await collect(provider.executeQuery(options({ maxTurns }))), 'maxTurns');
      expect(requests).toHaveLength(0);
    });

    it('rejects invalid operational budgets before HTTP', async () => {
      failure(
        await collect(
          provider.executeQuery(options({ openaiCompatibleAgent: { limits: { maxToolCalls: 0 } } }))
        ),
        'Invalid agent limit'
      );
      expect(requests).toHaveLength(0);
    });
  }
);
