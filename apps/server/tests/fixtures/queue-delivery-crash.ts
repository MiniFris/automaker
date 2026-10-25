import { AgentQueueDeliveryStore } from '../../src/services/agent/agent-queue-delivery-store.js';
import { AgentSessionRepository } from '../../src/services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../src/services/agent/agent-session-registry.js';

if (process.env.NODE_ENV !== 'test' || !process.env.DATA_DIR)
  throw new Error('Queue crash fixture requires an owned test DATA_DIR.');
const directory = process.env.DATA_DIR;
const id = 'crash-session';
const repository = new AgentSessionRepository(directory);
const store = new AgentQueueDeliveryStore(directory, repository, new AgentSessionRegistry());
await repository.initialize();
await repository.addMetadata({
  id,
  name: 'Crash fixture',
  workingDirectory: directory,
  createdAt: 'now',
  updatedAt: 'now',
  sdkSessionId: 'must-not-resume-unknown',
});
const prompt = {
  id: 'crash-prompt',
  message: 'Crash fixture request',
  model: 'sonnet',
  addedAt: 'now',
};
await repository.saveQueue(id, [prompt]);
const delivery = await store.claim(id, prompt);
if (process.env.DELIVERY_CRASH_STAGE !== 'claimed') await repository.saveQueue(id, []);
if (process.env.DELIVERY_CRASH_STAGE === 'completed')
  await repository.saveMessages(id, [
    {
      id: 'user',
      role: 'user',
      content: prompt.message,
      timestamp: 'now',
      deliveryId: delivery.deliveryId,
      queuedPromptId: prompt.id,
      deliveryStatus: 'completed',
    },
    { id: 'assistant', role: 'assistant', content: 'Durable answer', timestamp: 'now' },
  ]);
console.info(JSON.stringify({ event: 'queue-delivery-ready', sessionId: id }));
setInterval(() => undefined, 1000);
