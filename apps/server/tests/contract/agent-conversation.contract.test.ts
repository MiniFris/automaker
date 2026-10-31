import { mkdtemp, mkdir, rm, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { FeatureAgentOutputResponseSchema } from '@automaker/contracts/domains/feature-responses';
import type { ExecuteOptions, ProviderMessage } from '@automaker/types';
import { createNestApplication } from '../../src/main.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import type { ExecutionFilesystem } from '../../src/services/execution-filesystem.js';
import { AgentExecutor } from '../../src/services/agent-executor.js';
import { TypedEventBus } from '../../src/services/typed-event-bus.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import { MockProvider } from '../helpers/mock-provider.js';

class ConversationProvider extends MockProvider {
  failure = false;
  interrupt = false;
  onInterrupt?: () => void;
  protected override async *execute(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    yield {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Provider-supplied reasoning summary.' },
          { type: 'text', text: 'Checking the **task**.\n\n' },
          { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'README.md' } },
        ],
      },
    };
    yield {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'File contents' }],
      },
    };
    if (this.failure) throw new Error('Fixture provider failure');
    if (this.interrupt) {
      this.onInterrupt?.();
      throw new Error('Fixture interrupted');
    }
    yield {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Task finished.' }] },
    };
    yield { type: 'result', subtype: 'success', result: 'Task finished.' };
  }
}
let root: string, project: string, base: string;
let runtime: Awaited<ReturnType<typeof createNestApplication>>;
const live: Array<Record<string, unknown>> = [];
async function start() {
  runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      AUTOMAKER_API_KEY: 'fixture',
      ALLOWED_ROOT_DIRECTORY: root,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${(runtime.app.getHttpServer().address() as { port: number }).port}/api/features/agent-output`;
}
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'automaker-agent-chat-'));
  project = path.join(root, 'project');
  await mkdir(project);
  await start();
});
afterAll(async () => {
  await runtime?.app.close();
  if (root) await rm(root, { recursive: true, force: true });
});
function execute(
  featureId: string,
  provider = new ConversationProvider('gemini'),
  previousContent?: string,
  task = false
) {
  const abortController = new AbortController();
  provider.onInterrupt = () => abortController.abort();
  const executor = new AgentExecutor(
    new TypedEventBus({ emit: (_type, event) => live.push(event) } as never),
    { updateTaskStatus: vi.fn(), updateFeaturePlanSpec: vi.fn() } as never,
    {} as never,
    null,
    runtime.app.get<ExecutionFilesystem>(SECURE_FILESYSTEM)
  );
  return executor.execute(
    {
      projectPath: project,
      workDir: project,
      featureId,
      prompt: 'Internal fixture prompt',
      provider,
      model: 'gemini-2.5-flash',
      effectiveBareModel: '2.5-flash',
      abortController,
      previousContent,
      ...(task
        ? {
            existingApprovedPlanContent: 'Approved fixture plan',
            persistedTasks: [
              { id: 'T001', description: 'Fixture task', status: 'pending' as const },
            ],
          }
        : {}),
    },
    {
      waitForApproval: vi.fn(),
      saveFeatureSummary: vi.fn(),
      updateFeatureSummary: vi.fn(),
      buildTaskPrompt: () => 'Execute approved task',
    }
  );
}
async function read(featureId: string, projectPath = project) {
  const response = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'fixture' },
    body: JSON.stringify({ projectPath, featureId }),
  });
  expect(response.status).toBe(200);
  return FeatureAgentOutputResponseSchema.parse(await response.json());
}

it('persists ordered provider messages, thinking and tool results across runs and native restart', async () => {
  const first = await execute('chat');
  await execute('chat', undefined, first.responseText, true);
  const snapshot = await read('chat');
  expect(snapshot.conversation.map((e) => e.kind)).toEqual(
    Array(2)
      .fill([
        'session_start',
        'thinking',
        'assistant',
        'tool_call',
        'tool_result',
        'assistant',
        'session_end',
      ])
      .flat()
  );
  expect(
    snapshot.conversation.filter((e) => e.kind === 'assistant' && e.content === 'Task finished.')
  ).toHaveLength(2);
  expect(snapshot.conversation.find((e) => e.kind === 'tool_result')).toMatchObject({
    toolName: 'Read',
    toolCallId: 'read-1',
    content: 'File contents',
    status: 'completed',
  });
  expect(
    live.filter((event) => event.type === 'auto_mode_conversation').map((event) => event.entry)
  ).toEqual(snapshot.conversation);
  expect(new Set(snapshot.conversation.map((e) => e.id)).size).toBe(snapshot.conversation.length);
  expect(JSON.stringify(snapshot.conversation)).not.toContain('Internal fixture prompt');
  const other = path.join(root, 'other-project');
  await mkdir(other);
  expect((await read('chat', other)).conversation).toEqual([]);
  await runtime.app.close();
  await start();
  expect((await read('chat')).conversation).toEqual(snapshot.conversation);
});

it('records failures and interruptions with durable partial history', async () => {
  for (const status of ['failed', 'interrupted'] as const) {
    const provider = new ConversationProvider('gemini');
    provider.failure = status === 'failed';
    provider.interrupt = status === 'interrupted';
    await expect(execute(status, provider)).rejects.toThrow();
    const snapshot = await read(status);
    expect(snapshot.conversation.at(-1)).toMatchObject({ kind: 'session_end', status });
    expect(snapshot.conversation.some((e) => e.kind === 'tool_result')).toBe(true);
    expect(snapshot.conversation.at(-2)?.kind).toBe('error');
  }
});

it('keeps legacy task output readable and imports it once on continuation', async () => {
  const loader = runtime.app.get(FeatureLoader);
  await loader.saveAgentOutput(project, 'legacy', 'Earlier task output');
  expect(await read('legacy')).toMatchObject({ content: 'Earlier task output', conversation: [] });
  const first = await execute('legacy', undefined, 'Earlier task output');
  await execute('legacy', undefined, first.responseText);
  const history = (await read('legacy')).conversation;
  expect(history.filter((e) => e.kind === 'legacy')).toHaveLength(1);
  expect(history[0].content).toBe('Earlier task output');
});

it('recovers subsequent sessions after an incomplete final JSONL record', async () => {
  await execute('partial');
  const before = (await read('partial')).conversation;
  await appendFile(
    path.join(project, '.automaker/features/partial/agent-conversation.jsonl'),
    '{"incomplete":'
  );
  expect((await read('partial')).conversation).toEqual(before);
  await execute('partial');
  const after = (await read('partial')).conversation;
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after.filter((entry) => entry.kind === 'session_end')).toHaveLength(2);
});
