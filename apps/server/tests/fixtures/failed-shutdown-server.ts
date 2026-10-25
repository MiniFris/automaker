import { writeFile } from 'node:fs/promises';
import { createNestApplication } from '../../src/main.js';
import { TerminalService } from '../../src/services/terminal-service.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
if (process.env.NODE_ENV !== 'test' || !process.env.DATA_DIR || !process.env.SHUTDOWN_MARKER)
  throw new Error('Owned shutdown fixture required');
const runtime = await createNestApplication({
  host: '127.0.0.1',
  port: 0,
  workingDirectory: process.env.DATA_DIR,
  dataDir: process.env.DATA_DIR,
  runStartupTasks: false,
  providerRegistrations: [],
});
runtime.app.get(TerminalService).cleanup = async () => {
  throw new Error('private-signal-fixture');
};
const providers = runtime.app.get(ProviderRegistry),
  close = providers.onApplicationShutdown.bind(providers);
providers.onApplicationShutdown = async () => {
  await close();
  await writeFile(process.env.SHUTDOWN_MARKER!, 'closed');
};
await runtime.start();
process.send?.('ready');
