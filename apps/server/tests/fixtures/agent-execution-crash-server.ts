import { createNestApplication } from '../../src/main.js';
import { AgentSessionRepository } from '../../src/services/agent/agent-session.repository.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { MockProvider } from '../helpers/mock-provider.js';
import { AgentQueueDeliveryStore } from '../../src/services/agent/agent-queue-delivery-store.js';

if (process.env.NODE_ENV !== 'test' || !process.env.DATA_DIR)
  throw new Error('Execution crash fixture requires an owned test DATA_DIR.');
const directory = process.env.DATA_DIR;
const stage = process.env.EXECUTION_CRASH_STAGE;
if (
  !['before-history', 'running', 'intent', 'history', 'settled', 'queued-ledger'].includes(
    stage ?? ''
  )
)
  throw new Error('Unknown execution crash stage');
let sessionId = '',
  calls = 0,
  closed = false;
const pause = (): Promise<never> => {
  console.info(JSON.stringify({ event: 'agent-execution-ready', sessionId, calls, closed }));
  setInterval(() => undefined, 1000);
  return new Promise(() => undefined);
};
const provider = new MockProvider('claude');
provider.executeQuery = async function* () {
  calls++;
  closed = false;
  try {
    yield {
      type: 'assistant',
      session_id: 'fixture-sdk',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Durable fixture answer' }] },
    };
    if (stage === 'running') await pause();
    yield { type: 'result', subtype: 'success' };
  } finally {
    closed = true;
  }
};
const runtime = await createNestApplication({
  host: '127.0.0.1',
  port: 0,
  dataDir: directory,
  runStartupTasks: false,
  enableShutdownHooks: false,
  services: {
    providerRegistry: new ProviderRegistry([{ name: 'claude', create: () => provider }], {
      isDisconnected: () => false,
    } as never),
  },
});
await runtime.start();
const service = runtime.legacy.services.agentService;
sessionId = (await service.createSession('Crash fixture', directory, directory, 'sonnet')).id;
const repository = runtime.app.get(AgentSessionRepository);
await repository.updateMetadata(sessionId, { sdkSessionId: 'old-sdk' });
if (stage === 'queued-ledger') {
  await service.startConversation({ sessionId });
  await service.addToQueue(sessionId, { message: 'Queued once', model: 'sonnet' });
  runtime.app.get(AgentQueueDeliveryStore).consumeExecution = pause;
}
const save = repository.saveMessages.bind(repository);
repository.saveMessages = async (id, messages) => {
  if (
    stage === 'before-history' ||
    (stage === 'intent' && messages.some((item) => item.executionStatus === 'completed'))
  )
    await pause();
  return save(id, messages);
};
const touch = repository.touchMetadata.bind(repository);
repository.touchMetadata = async (id) => {
  if (stage === 'history' && calls) await pause();
  return touch(id);
};
await service.sendMessage({ sessionId, message: 'Execute once', model: 'sonnet' });
if (stage === 'queued-ledger') await new Promise(() => undefined);
await pause();
