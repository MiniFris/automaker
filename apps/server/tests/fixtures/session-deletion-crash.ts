import { AgentSessionRepository } from '../../src/services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../src/services/agent/agent-session-registry.js';
import { AgentExecutionCoordinator } from '../../src/services/agent/agent-execution-coordinator.js';
import { AgentQueueDeliveryStore } from '../../src/services/agent/agent-queue-delivery-store.js';
import { AgentSessionDeletion } from '../../src/services/agent/agent-session-deletion.js';

if (process.env.NODE_ENV !== 'test' || !process.env.DATA_DIR)
  throw new Error('Deletion crash fixture requires an owned test DATA_DIR.');
const directory = process.env.DATA_DIR;
const id = 'crash-session';
const repository = new AgentSessionRepository(directory);
const sessions = new AgentSessionRegistry();
const deliveries = new AgentQueueDeliveryStore(directory, repository, sessions);
await repository.initialize();
for (const sessionId of [id, 'retained-session']) {
  await repository.addMetadata({
    id: sessionId,
    name: 'Crash fixture',
    workingDirectory: directory,
    createdAt: 'now',
    updatedAt: 'now',
  });
  await repository.saveMessages(sessionId, [
    { id: 'message', role: 'user', content: 'Private request', timestamp: 'now' },
  ]);
  const prompt = { id: 'prompt', message: 'Queued request', addedAt: 'now' };
  await repository.saveQueue(sessionId, [prompt]);
  await deliveries.claim(sessionId, prompt);
}
const pause = async (): Promise<never> => {
  console.info(JSON.stringify({ event: 'session-deletion-ready', sessionId: id }));
  setInterval(() => undefined, 1000);
  return new Promise(() => undefined);
};
if (process.env.DELETION_CRASH_STAGE === 'marked') repository.removeSessionArtifacts = pause;
else if (process.env.DELETION_CRASH_STAGE === 'artifacts') repository.deleteMetadata = pause;
else if (process.env.DELETION_CRASH_STAGE === 'metadata') repository.completeDeletion = pause;
else throw new Error('Unknown deletion crash checkpoint');
await new AgentSessionDeletion(
  repository,
  sessions,
  new AgentExecutionCoordinator(),
  deliveries
).remove(id);
