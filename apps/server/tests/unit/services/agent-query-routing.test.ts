import { ApplicationMetrics } from '../../../src/core/observability/application-metrics.js';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeCompatibleProvider } from '@automaker/types';
import { resolveModelString } from '@automaker/model-resolver';
import { AgentService } from '../../../src/services/agent-service.js';
import { SettingsService } from '../../../src/services/settings-service.js';
import { ProviderRegistry } from '../../../src/modules/providers/provider-registry.service.js';
import { ToolPolicyService } from '../../../src/modules/providers/tool-policy.service.js';
import { createEventEmitter } from '../../../src/lib/events.js';
import {
  createTestAgentState,
  createTestAgentProviders,
  createTestAgentEvents,
} from '../../helpers/agent-state.js';
import { MockProvider } from '../../helpers/mock-provider.js';

describe('chat routing with real settings and SDK option construction', () => {
  let temporary: string | undefined;
  afterEach(async () => {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    temporary = undefined;
  });

  it.each([true, false])(
    'keeps the custom API ID across mapped-model changes and restart (explicit=%s)',
    async (explicit) => {
      temporary = await mkdtemp(path.join(os.tmpdir(), 'automaker-chat-routing-'));
      const project = path.join(temporary, 'project');
      await mkdir(project);
      const settings = new SettingsService(path.join(temporary, 'data'));
      const configured: ClaudeCompatibleProvider = {
        id: 'custom-endpoint',
        name: 'Custom fixture',
        providerType: 'custom',
        enabled: true,
        baseUrl: 'https://fixture.invalid',
        apiKeySource: 'inline',
        apiKey: 'fixture-secret',
        models: [{ id: 'GLM-4.7', displayName: 'GLM fixture', mapsToClaudeModel: 'opus' }],
      };
      await settings.updateGlobalSettings({
        claudeCompatibleProviders: [configured],
        autoLoadClaudeMd: false,
        useClaudeCodeSystemPrompt: false,
        enableSkills: false,
        enableSubagents: false,
        defaultMaxTurns: 23,
      });
      const adapter = new MockProvider('claude', [
        {
          id: 'claude-fixture',
          name: 'Fixture',
          modelString: 'fixture',
          provider: 'claude',
          description: 'Offline test adapter',
          supportsTools: true,
        },
      ]);
      const execute = vi.spyOn(adapter, 'executeQuery');
      const registry = new ProviderRegistry(
        [{ name: 'claude', create: () => adapter }],
        {
          isDisconnected: () => false,
        } as never,
        new ApplicationMetrics()
      );
      const create = () =>
        new AgentService(
          ...createTestAgentState(
            settings.getDataDirectory(),
            createTestAgentEvents(createEventEmitter())
          ),
          settings,
          ...createTestAgentProviders(registry, new ToolPolicyService())
        );
      const service = create();
      await service.initialize();
      const session = await service.createSession(
        'Custom chat',
        project,
        project,
        'GLM-4.7',
        explicit ? configured.id : undefined
      );
      expect(
        (
          await service.sendMessage({
            sessionId: session.id,
            message: 'First message',
            thinkingLevel: 'high',
          })
        ).success
      ).toBe(true);
      expect(execute.mock.calls[0][0]).toMatchObject({
        model: 'GLM-4.7',
        originalModel: resolveModelString('opus'),
        claudeCompatibleProvider: { id: configured.id },
        maxTurns: 23,
        thinkingLevel: 'high',
      });
      expect(execute.mock.calls[0][0].allowedTools).toContain('Read');
      await settings.updateGlobalSettings({
        claudeCompatibleProviders: [
          { ...configured, models: [{ ...configured.models[0], mapsToClaudeModel: 'sonnet' }] },
        ],
        defaultMaxTurns: 41,
      });
      const restarted = create();
      await restarted.initialize();
      expect(
        (await restarted.sendMessage({ sessionId: session.id, message: 'Continue' })).success
      ).toBe(true);
      expect(execute.mock.calls[1][0]).toMatchObject({
        model: 'GLM-4.7',
        originalModel: resolveModelString('sonnet'),
        maxTurns: 41,
        conversationHistory: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'Mock agent output for testing.' },
        ],
      });
      expect((await restarted.getHistory(session.id)).messages).toHaveLength(4);
      expect((await restarted.listSessions()).find((item) => item.id === session.id)).toMatchObject(
        { model: 'GLM-4.7' }
      );
    }
  );
});
