import { describe, expect, it, vi } from 'vitest';
import { resolveImmutableBinding } from '@/modules/execution/execution-binding.js';
import { ExecutionRegistry } from '@/modules/execution/execution-registry.service.js';
import type { ExecutionAdapter } from '@/modules/execution/execution.port.js';

const baseBinding = {
  version: 1 as const,
  id: 'binding-1',
  type: 'local' as const,
  projectPath: '/project',
  cwd: '/project',
  createdAt: '2026-01-01T00:00:00.000Z',
  serverIdentity: 'server',
  selection: { mode: 'local' as const },
  source: 'project' as const,
};

describe('ExecutionRegistry', () => {
  it('creates an immutable binding with explicit runtime identity', () => {
    const resolved = resolveImmutableBinding(baseBinding);
    expect(resolved).toMatchObject({
      type: 'local',
      targetId: 'binding-1',
      controllerCwd: '/project',
      runtimeCwd: '/project',
      authoritativeRoot: '/project',
    });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.binding)).toBe(true);
  });

  it('opens only the adapter selected by the server-issued binding', async () => {
    const local: ExecutionAdapter = {
      type: 'local',
      capabilities: new Set(['files', 'exec']),
      open: vi.fn().mockResolvedValue({ type: 'local' }),
    };
    const docker: ExecutionAdapter = {
      type: 'docker',
      capabilities: new Set(['files', 'exec']),
      open: vi.fn(),
    };
    const registry = new ExecutionRegistry([local, docker]);

    await expect(registry.open(baseBinding)).resolves.toMatchObject({
      binding: { type: 'local' },
      runtime: { type: 'local' },
    });
    expect(local.open).toHaveBeenCalledOnce();
    expect(docker.open).not.toHaveBeenCalled();
  });

  it('rejects an incomplete remote binding without Local fallback', async () => {
    const local: ExecutionAdapter = {
      type: 'local',
      capabilities: new Set(['files']),
      open: vi.fn(),
    };
    const registry = new ExecutionRegistry([local]);

    await expect(
      registry.open({
        ...baseBinding,
        type: 'ssh',
        selection: { mode: 'profile', profileId: 'ssh' },
      })
    ).rejects.toMatchObject({ code: 'INVALID_BINDING' });
    expect(local.open).not.toHaveBeenCalled();
  });
});
