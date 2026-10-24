import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it, vi } from 'vitest';
import { createProviderRegistrations } from '../../../src/modules/providers/provider-registrations.js';
import { ProviderRegistry } from '../../../src/modules/providers/provider-registry.service.js';
import { AgentService } from '../../../src/services/agent-service.js';
import {
  createTestAgentState,
  createTestAgentProviders,
  createTestAgentEvents,
} from '../../helpers/agent-state.js';
import { createEventEmitter } from '../../../src/lib/events.js';

it.each(['cursor', 'gemini'])(
  'rejects images for text-only %s transport before reading attachments or starting a provider',
  async (name) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-vision-capability-'));
    const registry = new ProviderRegistry(createProviderRegistrations({} as never), {
      isDisconnected: () => false,
    } as never);
    const models = registry.byName(name)!.getAvailableModels();
    const candidate = models.find((model) => model.supportsVision === true) ?? models[0];
    const state = createTestAgentState(directory, createTestAgentEvents(createEventEmitter()));
    const service = new AgentService(...state, undefined, ...createTestAgentProviders(registry));
    const read = vi.spyOn(state[3], 'readImages');
    const execute = vi.spyOn(registry, 'providerForModel');
    try {
      expect(candidate).toBeDefined();
      if (name === 'gemini') expect(candidate.supportsVision).toBe(true);
      await service.initialize();
      const session = await service.createSession('Fixture', directory, directory, candidate.id);
      await expect(
        service.sendMessage({
          sessionId: session.id,
          model: candidate.id,
          message: 'Image request',
          imagePaths: ['/must-not-read.png'],
        })
      ).rejects.toThrow('does not support image input');
      expect(read).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(await state[0].loadMessages(session.id)).toEqual([]);
    } finally {
      await state[2].onApplicationShutdown();
      await registry.onApplicationShutdown();
      await state[0].drain();
      await rm(directory, { recursive: true, force: true });
    }
  }
);
