import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createNestApplication } from '../../src/main.js';
import type { ExecuteOptions } from '../../src/providers/types.js';
import { MockProvider } from '../helpers/mock-provider.js';

// Test-only entrypoint. The caller owns DATA_DIR and this provider never calls an SDK.
if (process.env.NODE_ENV !== 'test' || !process.env.DATA_DIR)
  throw new Error('Active shutdown fixture requires an owned test DATA_DIR.');
const directory = process.env.DATA_DIR;
let sessionId = '';
const provider = new MockProvider('claude');
provider.executeQuery = async function* (options: ExecuteOptions) {
  const aborted = new Promise<void>((resolve) =>
    options.abortController!.signal.addEventListener('abort', () => resolve(), { once: true })
  );
  try {
    yield {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Partial fixture reply' }] },
    };
    console.info(JSON.stringify({ event: 'active-agent-ready', sessionId }));
    await aborted;
  } finally {
    const messages = JSON.parse(
      await readFile(path.join(directory, 'agent-sessions', `${sessionId}.json`), 'utf8')
    ) as Array<{ content: string }>;
    // A real asynchronous cleanup must finish before the process can exit cleanly.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await writeFile(
      path.join(directory, 'provider-cleanup.json'),
      JSON.stringify({
        aborted: options.abortController!.signal.aborted,
        interruptionPersistedBeforeCleanup: messages.some((message) =>
          message.content.startsWith('Interrupted:')
        ),
      })
    );
  }
};
const runtime = await createNestApplication({
  host: '127.0.0.1',
  port: 0,
  dataDir: directory,
  runStartupTasks: false,
  workingDirectory: directory,
  providerRegistrations: [{ name: 'claude', create: () => provider }],
});
await runtime.start();
sessionId = (
  await runtime.legacy.services.agentService.createSession(
    'Active shutdown fixture',
    directory,
    directory,
    'sonnet'
  )
).id;
await runtime.legacy.services.agentService.sendMessage({
  sessionId,
  message: 'Hold until shutdown',
});
