import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCPTestService } from '../../src/services/mcp-test-service.js';
import type { SettingsService } from '../../src/services/settings-service.js';
import type { MCPServerConfig } from '@automaker/types';

describe('MCP discovery transport lifecycle', () => {
  const directories: string[] = [];
  afterEach(async () => {
    for (const directory of directories.splice(0))
      await rm(directory, { recursive: true, force: true });
  });

  async function fixture(mode: string) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-mcp-contract-'));
    directories.push(directory);
    const pidPath = path.join(directory, 'server.pid');
    const config: MCPServerConfig = {
      id: 'fixture',
      name: 'Saved server',
      type: 'stdio',
      command: process.execPath,
      args: [path.resolve(import.meta.dirname, '../fixtures/mcp-test-server.mjs'), mode, pidPath],
      env: { TEST_MCP_SECRET: 'fixture-secret-must-be-redacted' },
    };
    const settings = { getGlobalSettings: vi.fn().mockResolvedValue({ mcpServers: [config] }) };
    const service = new MCPTestService(settings as unknown as SettingsService, 1000);
    return { service, pidPath };
  }

  async function expectProcessClosed(pidPath: string) {
    const pid = Number(await readFile(pidPath, 'utf8'));
    await vi.waitFor(() => {
      expect(() => process.kill(pid, 0)).toThrow();
    });
  }

  it('discovers a saved server through a real SDK handshake and closes its process', async () => {
    const { service, pidPath } = await fixture('success');
    const result = await service.testServerById('fixture');
    expect(result).toMatchObject({
      success: true,
      tools: [{ name: 'fixture_read', enabled: true }],
      serverInfo: { name: 'automaker-contract-mcp', version: '1.0.0' },
    });
    await expectProcessClosed(pidPath);
  });

  it('tests connection without waiting for tool discovery, and keeps tool-list failure separate', async () => {
    const connection = await fixture('hang-list');
    const result = await connection.service.testConnectionById('fixture');
    expect(result).toMatchObject({ success: true, serverInfo: { name: 'automaker-contract-mcp' } });
    expect(result).not.toHaveProperty('tools');
    await expectProcessClosed(connection.pidPath);
    const discovery = await fixture('hang-list');
    expect(await discovery.service.listToolsById('fixture')).toMatchObject({
      success: false,
      error: 'List tools timeout',
    });
    await expectProcessClosed(discovery.pidPath);
  });

  it.each(['hang-connect', 'hang-list'])(
    'bounds %s and closes the spawned server',
    async (mode) => {
      const { service, pidPath } = await fixture(mode);
      const result = await service.testServerById('fixture');
      expect(result).toMatchObject({
        success: false,
        error: mode === 'hang-connect' ? 'Connection timeout' : 'List tools timeout',
      });
      await expectProcessClosed(pidPath);
    }
  );

  it('redacts configured secrets from server errors before returning diagnostics', async () => {
    const { service, pidPath } = await fixture('fail');
    const result = await service.testServerById('fixture');
    expect(result.success).toBe(false);
    expect(result.error).toContain('[REDACTED]');
    expect(result.error).not.toContain('fixture-secret');
    await expectProcessClosed(pidPath);
  });

  it('rejects an oversized catalog and closes the server', async () => {
    const { service, pidPath } = await fixture('oversized');
    await expect(service.testServerById('fixture')).resolves.toMatchObject({
      success: false,
      error: 'MCP tool catalog exceeds the allowed size',
    });
    await expectProcessClosed(pidPath);
  });

  it('closes an in-flight handshake during application shutdown and rejects new discovery', async () => {
    const { service, pidPath } = await fixture('hang-connect');
    const pending = service.testServerById('fixture');
    await vi.waitFor(async () => expect(await readFile(pidPath, 'utf8')).toMatch(/^\d+$/));
    await service.beforeApplicationShutdown();
    await expect(pending).resolves.toMatchObject({ success: false });
    await expectProcessClosed(pidPath);
    await expect(service.testServerById('fixture')).resolves.toMatchObject({
      success: false,
      error: 'MCP discovery is shutting down',
    });
    await service.beforeApplicationShutdown();
  });
});
