import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModulesContainer } from '@nestjs/core';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { DevServerService } from '../../src/services/dev-server-service.js';
import { TestRunnerService } from '../../src/services/test-runner-service.js';
import { TerminalService } from '../../src/services/terminal-service.js';
import { AgentService } from '../../src/services/agent-service.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { AutoModeController } from '../../src/modules/auto-mode/auto-mode.controller.js';
import { AutoModeApplicationService } from '../../src/modules/auto-mode/auto-mode-application.service.js';
import { RunningAgentsService } from '../../src/modules/agents/running-agents.service.js';
import { SettingsRuntimeEffectsService } from '../../src/modules/settings/settings-runtime-effects.service.js';
import { TerminalController } from '../../src/modules/terminal/terminal.controller.js';
import { WebSocketTransportService } from '../../src/modules/terminal/websocket-transport.service.js';
import { WorktreeProcessService } from '../../src/modules/worktree/worktree-process.service.js';
import { AutoModeModule } from '../../src/modules/auto-mode/auto-mode.module.js';
import { TerminalRuntimeModule } from '../../src/modules/terminal/terminal-runtime.module.js';
import { LocalProcessRuntimeModule } from '../../src/modules/execution/local-process-runtime.module.js';
import { ManagedDevServerService } from '../../src/services/execution-environment/dev-server.js';
import { ManagedTestRunnerService } from '../../src/services/execution-environment/test-runner.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/security.module.js';

it('owns native runtimes once, applies per-app terminal config and preserves ordered cleanup without a legacy service bag', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-runtimes-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const spies: Array<{ mockRestore(): void }> = [];
  const start = async (name: string, maxSessions: number) => {
    const root = path.join(directory, name);
    await mkdir(root);
    const runtime = await createNestApplication({
      workingDirectory: root,
      dataDir: path.join(root, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      providerRegistrations: [],
      environment: { NODE_ENV: 'test', TERMINAL_MAX_SESSIONS: String(maxSessions) },
    });
    apps.push(runtime);
    expect(runtime.app.get(TerminalService).getMaxSessions()).toBe(maxSessions);
    return runtime;
  };
  const inspect = (value: unknown) => value as Record<string, unknown>;
  try {
    const first = await start('one', 2),
      second = await start('two', 5);
    for (const [token, owner] of [
      [AutoModeServiceCompat, AutoModeModule],
      [DevServerService, LocalProcessRuntimeModule],
      [TestRunnerService, LocalProcessRuntimeModule],
      [ManagedDevServerService, LocalProcessRuntimeModule],
      [ManagedTestRunnerService, LocalProcessRuntimeModule],
      [TerminalService, TerminalRuntimeModule],
    ] as const) {
      expect(first.app.get(token)).not.toBe(second.app.get(token));
      for (const runtime of apps) {
        const wrappers = [...runtime.app.get(ModulesContainer).values()]
          .flatMap((module) => [...module.providers.values()])
          .filter((entry) => entry.token === token);
        expect(wrappers).toHaveLength(1);
        expect(wrappers[0].instance).toBe(runtime.app.get(token));
        const owners = [...runtime.app.get(ModulesContainer).values()].filter((module) =>
          module.providers.has(token)
        );
        expect(owners).toHaveLength(1);
        expect(owners[0].metatype).toBe(owner);
      }
    }
    for (const runtime of apps) {
      const auto = runtime.app.get(AutoModeServiceCompat),
        terminal = runtime.app.get(TerminalService);
      const commands = runtime.app.get(AutoModeApplicationService);
      expect(inspect(runtime.app.get(AutoModeController)).commands).toBe(commands);
      for (const field of ['scheduler', 'workflows', 'recovery']) {
        expect(inspect(commands)[field]).toBe(auto);
      }
      expect(inspect(runtime.app.get(RunningAgentsService)).autoMode).toBe(auto);
      expect(inspect(runtime.app.get(TerminalController)).terminal).toBe(terminal);
      expect(inspect(runtime.app.get(WebSocketTransportService)).terminal).toBe(terminal);
      expect(inspect(runtime.app.get(SettingsRuntimeEffectsService)).terminal).toBe(terminal);
      expect(inspect(terminal).settingsService).toBe(runtime.app.get(SettingsService));
      const processes = inspect(runtime.app.get(WorktreeProcessService));
      expect(processes.localDev).toBe(runtime.app.get(DevServerService));
      expect(processes.localTests).toBe(runtime.app.get(TestRunnerService));
      expect(processes.managedDev).toBe(runtime.app.get(ManagedDevServerService));
      expect(processes.managedTests).toBe(runtime.app.get(ManagedTestRunnerService));
    }
    const order: string[] = [];
    const agent = first.app.get(AgentService),
      auto = first.app.get(AutoModeServiceCompat),
      terminal = first.app.get(TerminalService),
      tests = first.app.get(TestRunnerService),
      preview = first.app.get(DevServerService),
      providers = first.app.get(ProviderRegistry);
    const interrupt = agent.interruptActiveSessions.bind(agent),
      mark = auto.markAllRunningFeaturesInterrupted.bind(auto),
      stop = auto.interruptForShutdown.bind(auto),
      cleanTerminal = terminal.cleanup.bind(terminal),
      cleanTests = tests.cleanup.bind(tests),
      cleanPreview = preview.stopAll.bind(preview),
      closeProviders = providers.close.bind(providers);
    const filesystem = first.app.get(SECURE_FILESYSTEM),
      closeFilesystem = filesystem.close.bind(filesystem);
    spies.push(
      vi.spyOn(filesystem, 'close').mockImplementation(() => {
        order.push('filesystem');
        return closeFilesystem();
      }),
      vi.spyOn(agent, 'interruptActiveSessions').mockImplementation((reason) => {
        order.push('agent');
        return interrupt(reason);
      }),
      vi.spyOn(auto, 'markAllRunningFeaturesInterrupted').mockImplementation((reason) => {
        order.push('feature');
        return mark(reason);
      }),
      vi.spyOn(auto, 'interruptForShutdown').mockImplementation(() => {
        order.push('auto');
        return stop();
      }),
      vi.spyOn(terminal, 'cleanup').mockImplementation(() => {
        order.push('terminal');
        return cleanTerminal();
      }),
      vi.spyOn(tests, 'cleanup').mockImplementation(() => {
        order.push('tests');
        return cleanTests();
      }),
      vi.spyOn(preview, 'stopAll').mockImplementation(() => {
        order.push('preview');
        return cleanPreview();
      }),
      vi.spyOn(providers, 'close').mockImplementation(() => {
        order.push('providers');
        return closeProviders();
      })
    );
    const providerHook = vi.spyOn(providers, 'onApplicationShutdown');
    const scopeDisposal = vi.spyOn(
      (providers as unknown as { executions: { dispose(): Promise<void> } }).executions,
      'dispose'
    );
    spies.push(providerHook, scopeDisposal);
    const otherCleanup = vi.spyOn(second.app.get(TerminalService), 'cleanup');
    spies.push(otherCleanup);
    await first.app.close();
    expect(order).toEqual([
      'agent',
      'feature',
      'auto',
      'terminal',
      'tests',
      'preview',
      'providers',
      'filesystem',
    ]);
    expect(providerHook).toHaveBeenCalledOnce();
    expect(scopeDisposal).toHaveBeenCalledOnce();
    expect(otherCleanup).not.toHaveBeenCalled();
    expect(second.app.get(TerminalService).getMaxSessions()).toBe(5);
    await first.app.close();
    expect(order).toEqual([
      'agent',
      'feature',
      'auto',
      'terminal',
      'tests',
      'preview',
      'providers',
      'filesystem',
    ]);
  } finally {
    for (const spy of spies) spy.mockRestore();
    await Promise.all(apps.map(({ app }) => app.close()));
    await rm(directory, { recursive: true, force: true });
  }
});
