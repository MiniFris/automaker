import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { ProviderInstallGuidanceSchema } from '@automaker/contracts';
import { createNestApplication } from '../../src/main.js';
import { SetupHandlersService } from '../../src/modules/providers/setup-handlers.service.js';
import { ProviderConnectionCommandService } from '../../src/modules/providers/provider-connection-command.service.js';
import { SetupStatusRuntime } from '../../src/core/platform/setup-status.runtime.js';

it('serves native read-only install guidance without bridge calls, probes or connection mutations', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-install-guidance-'));
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture-api-key',
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  try {
    const bridge = vi.spyOn(runtime.app.get(SetupHandlersService), 'run');
    const connections = runtime.app.get(ProviderConnectionCommandService);
    const disconnect = vi.spyOn(connections, 'disconnect');
    const reconnect = vi.spyOn(connections, 'reconnect');
    const host = runtime.app.get(SetupStatusRuntime);
    const claude = vi.spyOn(host, 'claudeIndicators');
    const codex = vi.spyOn(host, 'codexIndicators');
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    for (const provider of ['claude', 'codex'] as const) {
      const response = await fetch(`http://127.0.0.1:${port}/api/setup/install-${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status).toBe(200);
      const body = ProviderInstallGuidanceSchema.parse(await response.json());
      expect(body).toEqual({
        ...(provider === 'claude'
          ? {
              success: false,
              error:
                'CLI installation requires terminal access. Please install manually using: npm install -g @anthropic-ai/claude-code',
            }
          : {
              success: true,
              message: 'Please install Codex CLI manually by running: npm install -g @openai/codex',
            }),
        requiresManualInstall: true,
        installationPerformed: false,
        installCommand:
          provider === 'claude'
            ? 'npm install -g @anthropic-ai/claude-code'
            : 'npm install -g @openai/codex',
        target: connections.target(provider).target,
      });
      expect(body.target.workingDirectory).toBe(directory);
    }
    expect(bridge).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();
    expect(claude).not.toHaveBeenCalled();
    expect(codex).not.toHaveBeenCalled();
  } finally {
    await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
