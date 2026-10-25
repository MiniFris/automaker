import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { MCPTestService } from '../../src/services/mcp-test-service.js';
import type { SettingsService } from '../../src/services/settings-service.js';
import type { MCPServerConfig } from '@automaker/types';

it.each(['stdio', 'sse', 'http'] as const)(
  'rejects missing %s configuration before acquiring any transport',
  async (type) => {
    const service = new MCPTestService({ getGlobalSettings: async () => ({}) } as SettingsService);
    try {
      const result = await service.testServer({ id: 'invalid', name: 'Invalid', type });
      expect(result).toMatchObject({ success: false });
      expect(result.error).toContain(type === 'stdio' ? 'Command is required' : 'URL is required');
      expect(service.activeOperationCount).toBe(0);
    } finally {
      await service.onModuleDestroy();
    }
  }
);

it.each([undefined, [], [{ id: 'other', name: 'Other', type: 'stdio', command: 'never-execute' }]])(
  'rejects an absent saved server without transport dispatch',
  async (mcpServers) => {
    const service = new MCPTestService({
      getGlobalSettings: async () => ({ mcpServers }),
    } as SettingsService);
    try {
      expect(await service.testServerById('absent')).toMatchObject({
        success: false,
        error: 'Server with ID "absent" not found',
      });
      expect(service.activeOperationCount).toBe(0);
    } finally {
      await service.onModuleDestroy();
    }
  }
);

it.each([new Error('private-settings-failure'), 'private-non-error-failure'])(
  'keeps saved-settings failures controlled and closes their operation',
  async (failure) => {
    const service = new MCPTestService({
      getGlobalSettings: async () => {
        throw failure;
      },
    } as unknown as SettingsService);
    try {
      const result = await service.testServerById('absent');
      expect(result.success).toBe(false);
      expect(result.error).not.toContain('private-');
      expect(service.activeOperationCount).toBe(0);
    } finally {
      await service.onModuleDestroy();
    }
  }
);

it.each(['empty', 'rich-tools', 'malformed-tools'])(
  'validates actual SDK stdio tool mapping for %s',
  async (mode) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-tool-contract-'));
    const config: MCPServerConfig = {
      id: 'saved',
      name: 'Private',
      type: 'stdio',
      command: process.execPath,
      args: [
        path.resolve(import.meta.dirname, '../fixtures/mcp-test-server.mjs'),
        mode,
        path.join(root, 'server.pid'),
      ],
    };
    const service = new MCPTestService(
      { getGlobalSettings: async () => ({ mcpServers: [config] }) } as unknown as SettingsService,
      1000
    );
    try {
      const result = await service.testServerById('saved');
      if (mode === 'empty') expect(result).toMatchObject({ success: true, tools: [] });
      else if (mode === 'rich-tools')
        expect(result.tools).toEqual([
          {
            name: 'complex-tool',
            description: 'A complex tool',
            inputSchema: { type: 'object', properties: { arg1: { type: 'string' } } },
            enabled: true,
          },
        ]);
      else {
        expect(result.success).toBe(false);
        expect(result.tools).toBeUndefined();
      }
      expect(service.activeOperationCount).toBe(0);
    } finally {
      await service.onModuleDestroy();
      await fs.rm(root, { recursive: true, force: true });
    }
  }
);
