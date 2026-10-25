import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AgentService } from '../../src/services/agent-service.js';
import { AgentSessionLoader } from '../../src/services/agent/agent-session-loader.js';
import { AgentSessionRepository } from '../../src/services/agent/agent-session.repository.js';
import { IdeationService } from '../../src/services/ideation-service.js';

it('enforces native directory policy per application without mutating process environment or global listeners', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-bootstrap-policy-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const environment = { ...process.env };
  const rejectionListeners = process.listeners('unhandledRejection');
  const exceptionListeners = process.listeners('uncaughtException');
  const start = async (name: string) => {
    const root = path.join(directory, name);
    await mkdir(root);
    const runtime = await createNestApplication({
      workingDirectory: root,
      dataDir: path.join(root, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      providerRegistrations: [],
      environment: { NODE_ENV: 'test', ALLOWED_ROOT_DIRECTORY: root, AUTOMAKER_API_KEY: 'fixture' },
    });
    apps.push(runtime);
    return { runtime, root };
  };
  try {
    const first = await start('one'),
      second = await start('two');
    expect(process.env).toEqual(environment);
    expect(process.listeners('unhandledRejection')).toEqual(rejectionListeners);
    expect(process.listeners('uncaughtException')).toEqual(exceptionListeners);
    const agent = first.runtime.app.get(AgentService);
    await expect(agent.createSession('allowed', first.root, first.root)).resolves.toMatchObject({
      name: 'allowed',
    });
    await expect(agent.createSession('denied', second.root, second.root)).rejects.toThrow(
      'Path not allowed'
    );
    await expect(
      second.runtime.app.get(AgentService).createSession('allowed', second.root, second.root)
    ).resolves.toMatchObject({ name: 'allowed' });
    await expect(first.runtime.app.get(IdeationService).startSession(second.root)).rejects.toThrow(
      'Path not allowed'
    );
    const repository = first.runtime.app.get(AgentSessionRepository);
    const metadata = vi.spyOn(repository, 'loadMetadata').mockResolvedValue({
      external: { id: 'external', name: 'External', workingDirectory: second.root },
    } as never);
    const messages = vi.spyOn(repository, 'loadMessages').mockResolvedValue([]);
    try {
      expect(await first.runtime.app.get(AgentSessionLoader).ensure('external')).toBeNull();
    } finally {
      metadata.mockRestore();
      messages.mockRestore();
    }
  } finally {
    await Promise.all(apps.map(({ app }) => app.close()));
    await rm(directory, { recursive: true, force: true });
  }
});
