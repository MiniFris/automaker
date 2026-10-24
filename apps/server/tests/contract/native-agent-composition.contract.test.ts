import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModulesContainer } from '@nestjs/core';
import { expect, it } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AgentService } from '../../src/services/agent-service.js';
import { AgentApplicationService } from '../../src/modules/agents/agent-application.service.js';
import { AgentSessionAdapter } from '../../src/modules/sessions/agent-session.adapter.js';
import { AgentSessionRegistry } from '../../src/services/agent/agent-session-registry.js';
import { AgentSessionRepository } from '../../src/services/agent/agent-session.repository.js';
import { AgentConversationCoordinator } from '../../src/services/agent/agent-conversation-coordinator.js';
import { AgentProviderSelector } from '../../src/services/agent/agent-provider-selector.js';

it('owns one native agent facade per application and shares it between chat and sessions without a legacy service alias', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-agents-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const start = async (name: string) => {
    const root = path.join(directory, name);
    await mkdir(root);
    const runtime = await createNestApplication({
      workingDirectory: root,
      dataDir: path.join(root, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      providerRegistrations: [],
    });
    apps.push(runtime);
    return runtime;
  };
  try {
    const first = await start('one'),
      second = await start('two');
    for (const runtime of apps) {
      const agent = runtime.app.get(AgentService);
      expect(runtime.legacy.services).not.toHaveProperty('agentService');
      const wrappers = [...runtime.app.get(ModulesContainer).values()]
        .flatMap((module) => [...module.providers.values()])
        .filter((entry) => entry.token === AgentService);
      expect(wrappers).toHaveLength(1);
      expect(wrappers[0].instance).toBe(agent);
      expect(
        (runtime.app.get(AgentApplicationService) as unknown as { agents: unknown }).agents
      ).toBe(agent);
      expect((runtime.app.get(AgentSessionAdapter) as unknown as { agent: unknown }).agent).toBe(
        agent
      );
      const dependencies = agent as unknown as Record<string, unknown>;
      for (const [field, token] of [
        ['repository', AgentSessionRepository],
        ['sessions', AgentSessionRegistry],
        ['conversations', AgentConversationCoordinator],
        ['providers', AgentProviderSelector],
      ] as const)
        expect(dependencies[field]).toBe(runtime.app.get(token));
    }
    expect(first.app.get(AgentService)).not.toBe(second.app.get(AgentService));
    const input = {
      name: 'Native fixture',
      projectPath: directory,
      workingDirectory: directory,
      model: 'sonnet',
    };
    const session = await first.app.get(AgentSessionAdapter).create(input);
    expect(await first.app.get(AgentService).listSessions()).toEqual([
      expect.objectContaining({ id: session.id }),
    ]);
    expect(await second.app.get(AgentService).listSessions()).toEqual([]);
    await first.app.close();
    const remaining = await second.app.get(AgentSessionAdapter).create(input);
    expect(await second.app.get(AgentService).listSessions()).toEqual([
      expect.objectContaining({ id: remaining.id }),
    ]);
  } finally {
    await Promise.all(apps.map(({ app }) => app.close()));
    await rm(directory, { recursive: true, force: true });
  }
});
