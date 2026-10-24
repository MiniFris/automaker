import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModulesContainer } from '@nestjs/core';
import { expect, it, vi } from 'vitest';
import { createNestApplication, type NestApplicationFactoryOptions } from '../../src/main.js';
import {
  ProviderRegistry,
  PROVIDER_REGISTRATIONS,
} from '../../src/modules/providers/provider-registry.service.js';
import { ProviderConnectionRepository } from '../../src/modules/providers/provider-connection.repository.js';
import { ToolPolicyService } from '../../src/modules/providers/tool-policy.service.js';
import { AgentProviderSelector } from '../../src/services/agent/agent-provider-selector.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { MockProvider } from '../helpers/mock-provider.js';
import { IdeationService } from '../../src/services/ideation-service.js';

it.each([
  { metadata: [{ name: 'claude' }, { name: 'CLAUDE' }] },
  { metadata: [{ name: 'claude', aliases: ['anthropic'] }, { name: 'ANTHROPIC' }] },
  { metadata: [{ name: 'claude', aliases: ['CLAUDE'] }] },
  { metadata: [{ name: 'claude', aliases: [''] }] },
])(
  'rejects ambiguous registration metadata before creating adapters or services (%j)',
  async ({ metadata }) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-invalid-provider-metadata-'));
    const create = vi.fn(() => new MockProvider('claude'));
    try {
      await expect(
        createNestApplication({
          workingDirectory: directory,
          dataDir: directory,
          runStartupTasks: false,
          enableShutdownHooks: false,
          providerRegistrations: metadata.map((entry) => ({ ...entry, create })),
        })
      ).rejects.toThrow('Duplicate provider name or alias:');
      expect(create).not.toHaveBeenCalled();
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it('owns registry, connection repository and tool policy exactly once per Nest application outside the legacy bag', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-providers-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const start = async (name: string) => {
    const root = path.join(directory, name);
    await mkdir(root);
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: root,
      dataDir: path.join(root, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: { NODE_ENV: 'test', ENABLE_REQUEST_LOGGING: 'false' },
    });
    apps.push(runtime);
    return runtime;
  };
  try {
    const first = await start('one'),
      second = await start('two');
    for (const token of [ProviderRegistry, ProviderConnectionRepository, ToolPolicyService]) {
      expect(first.app.get(token)).not.toBe(second.app.get(token));
      for (const runtime of apps) {
        const wrappers = [...runtime.app.get(ModulesContainer).values()]
          .flatMap((module) => [...module.providers.values()])
          .filter((entry) => entry.token === token);
        expect(wrappers, token.name).toHaveLength(1);
        expect(wrappers[0].instance).toBe(runtime.app.get(token));
      }
    }
    for (const runtime of apps) {
      expect(runtime).not.toHaveProperty('legacy');
      const registry = runtime.app.get(ProviderRegistry),
        policy = runtime.app.get(ToolPolicyService);
      const auto = runtime.app.get(AutoModeServiceCompat) as unknown as {
        facadeOptions: { providerRegistry: unknown; toolPolicy: unknown };
      };
      const ideation = runtime.app.get(IdeationService) as unknown as { providerRegistry: unknown };
      const selector = runtime.app.get(AgentProviderSelector) as unknown as {
        registry: unknown;
        tools: unknown;
      };
      expect(auto.facadeOptions.providerRegistry).toBe(registry);
      expect(auto.facadeOptions.toolPolicy).toBe(policy);
      expect(ideation.providerRegistry).toBe(registry);
      expect(selector.registry).toBe(registry);
      expect(selector.tools).toBe(policy);
      const registrations = runtime.app.get(PROVIDER_REGISTRATIONS);
      expect(Object.isFrozen(registrations)).toBe(true);
      expect(registrations.map((entry: { name: string }) => entry.name)).toEqual([
        'openai-compatible',
        'claude',
        'cursor',
        'codex',
        'opencode',
        'gemini',
        'copilot',
      ]);
      expect(registry.byName('anthropic')?.getName()).toBe('claude');
      expect(registry.byName('google')?.getName()).toBe('gemini');
      expect(registry.byName('github')?.getName()).toBe('copilot');
    }
    const connections = first.app.get(ProviderConnectionRepository);
    expect(connections.hostIdentity().instanceId).not.toBe(
      second.app.get(ProviderConnectionRepository).hostIdentity().instanceId
    );
    await connections.disconnect('cursor');
    expect(() => first.app.get(ProviderRegistry).providerForModel('cursor-auto')).toThrow(
      'disconnected'
    );
    expect(second.app.get(ProviderRegistry).providerForModel('cursor-auto').getName()).toBe(
      'cursor'
    );
    await connections.reconnect('cursor');
    expect(first.app.get(ProviderRegistry).providerForModel('cursor-auto').getName()).toBe(
      'cursor'
    );
    await first.app.close();
    expect(second.app.get(ProviderRegistry).providerForModel('cursor-auto').getName()).toBe(
      'cursor'
    );
  } finally {
    await Promise.all(apps.map(({ app }) => app.close()));
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  'providerRegistry',
  'providerConnections',
  'agentService',
  'settingsService',
  'events',
  'loginAttemptStore',
  'featureLoader',
  'notificationService',
  'eventHistoryService',
  'mcpTestService',
  'ideationService',
  'pipelineService',
  'eventHookService',
  'autoModeService',
  'terminalService',
  'testRunnerService',
  'devServerService',
])(
  'rejects retired legacy override %s before creating services or falling back to production adapters',
  async (key) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-retired-provider-override-'));
    try {
      await expect(
        createNestApplication({
          workingDirectory: directory,
          dataDir: directory,
          runStartupTasks: false,
          enableShutdownHooks: false,
          services: { [key]: {} },
        } as unknown as NestApplicationFactoryOptions)
      ).rejects.toThrow(
        'Legacy service overrides are not supported. Configure native services through their owning modules.'
      );
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it.each([false, true])(
  'creates the native owner even with explicit custom/empty registrations (empty=%s)',
  async (empty) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-provider-registrations-'));
    const registrations = empty
      ? []
      : [{ name: 'claude', create: () => new MockProvider('claude') }];
    const runtime = await createNestApplication({
      workingDirectory: directory,
      dataDir: path.join(directory, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      providerRegistrations: registrations,
    });
    try {
      const registry = runtime.app.get(ProviderRegistry);
      expect(registry.all().map((provider) => provider.getName())).toEqual(empty ? [] : ['claude']);
      expect(runtime.app.get(PROVIDER_REGISTRATIONS)).not.toBe(registrations);
      registrations.push({ name: 'late', create: () => new MockProvider('late') });
      expect(registry.byName('late')).toBeNull();
    } finally {
      await runtime.app.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);
